import re
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

# Target chunk size in approximate tokens (1 token ≈ 4 chars in English)
CHUNK_TOKEN_LIMIT = 512
CHUNK_OVERLAP_TOKENS = 50
CHARS_PER_TOKEN = 4  # conservative approximation

CHUNK_CHAR_LIMIT = CHUNK_TOKEN_LIMIT * CHARS_PER_TOKEN      # 2048 chars
OVERLAP_CHAR_LIMIT = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN  # 200 chars


def _split_into_sentences(text: str) -> List[str]:
    """
    Splits text into sentences using punctuation boundaries.
    Works reliably on plain text, markdown, and loosely-structured docs
    because it does NOT rely on headers or document structure.
    """
    # Split on: '. ', '! ', '? ', '.\n', '!\n', '?\n'
    # Uses a lookbehind so the punctuation stays at the end of each sentence.
    sentence_endings = re.compile(r'(?<=[.!?])\s+')
    raw_sentences = sentence_endings.split(text.strip())

    # Further split on hard newlines (paragraph breaks) to respect any
    # structural boundaries that do exist without requiring them.
    sentences: List[str] = []
    for sentence in raw_sentences:
        parts = [p.strip() for p in sentence.split('\n\n') if p.strip()]
        sentences.extend(parts)

    return [s for s in sentences if s]


def chunk_text(text: str) -> List[Dict]:
    """
    Format-agnostic, sentence-boundary-aware chunker.

    Strategy:
      1. Split the document into sentences (no header dependency).
      2. Greedily pack sentences into chunks up to ~512 tokens (2048 chars).
      3. When a chunk is full, carry the last `OVERLAP_CHAR_LIMIT` chars
         of the previous chunk into the next one to preserve context
         across chunk boundaries.

    Args:
        text: Raw input text (any format — plain text, markdown, HTML-stripped, PDF text).

    Returns:
        List of dicts: [{"content": str, "chunk_index": int}, ...]
    """
    if not text or not text.strip():
        logger.warning("chunk_text received empty input — returning empty list.")
        return []

    sentences = _split_into_sentences(text)
    chunks: List[Dict] = []
    current_chunk = ""
    chunk_index = 0

    for sentence in sentences:
        candidate = (current_chunk + " " + sentence).strip() if current_chunk else sentence

        if len(candidate) <= CHUNK_CHAR_LIMIT:
            # Sentence fits — keep packing
            current_chunk = candidate
        else:
            # Current chunk is full — save it
            if current_chunk:
                chunks.append({
                    "content": current_chunk.strip(),
                    "chunk_index": chunk_index,
                })
                chunk_index += 1

                # Carry overlap: take the tail of the previous chunk
                # so the next chunk preserves cross-boundary context
                overlap_text = current_chunk[-OVERLAP_CHAR_LIMIT:].strip()
                current_chunk = (overlap_text + " " + sentence).strip()
            else:
                # Single sentence is longer than the limit — force-split it
                # by treating the sentence itself as its own chunk
                chunks.append({
                    "content": sentence.strip(),
                    "chunk_index": chunk_index,
                })
                chunk_index += 1
                current_chunk = sentence[-OVERLAP_CHAR_LIMIT:].strip()

    # Flush the remaining buffer as the final chunk
    if current_chunk.strip():
        chunks.append({
            "content": current_chunk.strip(),
            "chunk_index": chunk_index,
        })

    logger.info(f"chunk_text produced {len(chunks)} chunks from {len(text)} chars of input.")
    return chunks
