import os
import logging
from typing import Any, Dict, List

import google.generativeai as genai
from fastembed import SparseTextEmbedding
from qdrant_client.models import PointStruct, SparseVector

from db.qdrant_client import qdrant, DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sparse model — lazily initialized singleton (fastembed downloads on first use)
# ---------------------------------------------------------------------------
_sparse_model: SparseTextEmbedding | None = None


def _get_sparse_model() -> SparseTextEmbedding:
    global _sparse_model
    if _sparse_model is None:
        logger.info("Initializing fastembed BM25 sparse embedding model...")
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


# ---------------------------------------------------------------------------
# Dense Embedding (Google text-embedding-004 — 768 dims)
# ---------------------------------------------------------------------------

def generate_dense_embedding(text: str) -> List[float]:
    """
    Generates a 768-dimensional dense vector using Google's text-embedding-004 model.

    Args:
        text: Input text to embed.

    Returns:
        List of 768 floats (the embedding vector).

    Raises:
        RuntimeError: If GOOGLE_API_KEY is not set or the API call fails.
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY environment variable is not set.")

    genai.configure(api_key=api_key)

    result = genai.embed_content(
        model="models/gemini-embedding-001",
        content=text,
        task_type="RETRIEVAL_DOCUMENT",
        output_dimensionality=768
    )
    return result["embedding"]


# ---------------------------------------------------------------------------
# Sparse Embedding (fastembed BM25 — for hybrid search keyword matching)
# ---------------------------------------------------------------------------

def generate_sparse_embedding(text: str) -> Dict[str, List]:
    """
    Generates a sparse BM25-style embedding vector using fastembed.

    Args:
        text: Input text to embed.

    Returns:
        Dict with 'indices' (List[int]) and 'values' (List[float]).
    """
    model = _get_sparse_model()
    embeddings = list(model.embed([text]))
    sparse = embeddings[0]
    return {
        "indices": sparse.indices.tolist(),
        "values": sparse.values.tolist(),
    }


# ---------------------------------------------------------------------------
# Qdrant Upsert
# ---------------------------------------------------------------------------

def upsert_to_qdrant(
    collection_name: str,
    point_id: str,
    dense_vector: List[float],
    sparse_vector: Dict[str, List],
    payload: Dict[str, Any],
) -> None:
    """
    Upserts a single point into the specified Qdrant collection.
    Uses the Supabase UUID as the point_id for cross-database traceability.

    Args:
        collection_name: Target collection (KB_ARTICLES_COLLECTION or TICKET_MESSAGES_COLLECTION).
        point_id: Exact Supabase UUID string — used as the Qdrant point ID.
        dense_vector: 768-dim float list from generate_dense_embedding().
        sparse_vector: Dict with 'indices' and 'values' from generate_sparse_embedding().
        payload: Arbitrary metadata dict stored alongside the vector in Qdrant.
    """
    qdrant.upsert(
        collection_name=collection_name,
        points=[
            PointStruct(
                id=point_id,
                vector={
                    DENSE_VECTOR_NAME: dense_vector,
                    SPARSE_VECTOR_NAME: SparseVector(
                        indices=sparse_vector["indices"],
                        values=sparse_vector["values"],
                    ),
                },
                payload=payload,
            )
        ],
    )
    logger.info(f"Upserted point {point_id} into Qdrant collection '{collection_name}'.")
