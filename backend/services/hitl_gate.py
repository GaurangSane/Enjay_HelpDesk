"""
services/hitl_gate.py
----------------------
Core RAG answer pipeline with a 2-stage Human-in-the-Loop (HITL) routing gate.

Stage 1 — Vector Distance Gate:
    Hybrid search on kb_articles. If max similarity score < 0.75,
    immediately route to HITL — don't waste an LLM call on weak retrieval.

Stage 2 — LLM Confidence Gate:
    Ask Groq to answer strictly from retrieved chunks and self-report a
    confidence score. If score < 8 or no citations, route to HITL.

Returns a typed action dict consumed by the Celery task dispatcher and
the HITL dashboard — never sends the email itself.
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Any

from groq import Groq
from qdrant_client import models
from backend.db.supabase_client import supabase
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION
from backend.services.embedding import generate_dense_embedding, generate_sparse_embedding
from backend.services.query_generation import generate_standalone_query

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

GROQ_MODEL = "llama-3.3-70b-versatile"
TOP_K = 5
PREFETCH_LIMIT = 20
VECTOR_SCORE_THRESHOLD = 0.75   # Stage 1 gate
LLM_CONFIDENCE_THRESHOLD = 8    # Stage 2 gate (out of 10)

_SYSTEM_PROMPT = """You are a technical support assistant for enterprise software.

STRICT RULES — read carefully and follow exactly:
1. You MUST answer ONLY using the support knowledge base chunks provided below in the user message.
2. You MUST NOT use any knowledge from your training data or general world knowledge.
3. If the provided chunks do not contain enough information to answer the question fully and confidently, you MUST give a low confidence_score (4 or below).
4. Do NOT inflate your confidence_score. If you are even slightly uncertain, score it honestly — agents will review low-confidence responses. Defaulting to a high number is a critical failure.
5. cited_chunk_ids MUST only contain IDs that appear verbatim in the provided chunks. Never invent chunk IDs.
6. cited_chunk_ids MUST NOT be empty if you provide an answer.
7. You MUST write and format the content of the 'answer' field specifically as a professional, well-formatted support email following these rules:
   - Start with a warm, professional greeting at the very beginning: use "Hi {customer_name}," using the actual customer name provided in the user context, or a generic "Hi there," if the name is 'there' or unavailable.
   - Use a helpful, human, and conversational tone that isn't robotic or overly formal.
   - Include clear paragraph breaks (using double newlines `\\n\\n`) between distinct points, thoughts, or steps to avoid a single dense block of text.
   - If the answer involves steps or instructions, format them clearly as a numbered or bulleted list to maximize readability.
   - End the message with the exact professional sign-off:
     Best regards,
     Enjay Helpdesk Support Team

OUTPUT FORMAT: Respond ONLY with a valid JSON object and nothing else. Do not change the JSON structure:
{
  "answer": "<your full reply to the customer, formatted as a professional email with the greeting containing their name, paragraph breaks, list formatting, and the required sign-off>",
  "confidence_score": <integer from 1 to 10>,
  "cited_chunk_ids": ["<chunk_point_id_1>", "<chunk_point_id_2>"]
}"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run_hybrid_search(query: str) -> list[dict]:
    """
    Runs hybrid search (dense + sparse RRF) against kb_articles.
    Returns a list of dicts with id, score, and payload for each hit.
    """
    dense_vector = generate_dense_embedding(query)
    sparse_vector = generate_sparse_embedding(query)

    results = qdrant.query_points(
        collection_name=KB_ARTICLES_COLLECTION,
        prefetch=[
            models.Prefetch(query=dense_vector, using="dense", limit=PREFETCH_LIMIT),
            models.Prefetch(
                query=models.SparseVector(
                    indices=sparse_vector["indices"],
                    values=sparse_vector["values"],
                ),
                using="sparse",
                limit=PREFETCH_LIMIT,
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=TOP_K,
        with_payload=True,
    )

    return [
        {
            "chunk_point_id": str(hit.id),
            "score": hit.score,
            "content": hit.payload.get("content", "") if hit.payload else "",
            "kb_article_id": hit.payload.get("kb_article_id", "") if hit.payload else "",
            "chunk_index": hit.payload.get("chunk_index", 0) if hit.payload else 0,
        }
        for hit in results.points
    ]


def get_friendly_name(email: str | None) -> str:
    """
    Extracts a friendly first name from a customer email address.
    e.g., 'john.smith@gmail.com' -> 'John'
          'jane_doe@company.com' -> 'Jane'
          'info@company.com' -> 'Info'
          '12345@domain.com' -> 'there' (fallback for purely numeric usernames)
    """
    if not email or "@" not in email:
        return "there"
    username = email.split("@")[0].split("+")[0]
    parts = [
        p.capitalize()
        for p in username.replace(".", " ").replace("-", " ").replace("_", " ").split()
        if p
    ]
    if parts and not parts[0].isdigit():
        return parts[0]
    return "there"


def _build_context_block(chunks: list[dict]) -> str:
    """Formats retrieved chunks into a numbered context block for the LLM prompt."""
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        lines.append(
            f"[CHUNK {i} | id: {chunk['chunk_point_id']}]\n{chunk['content']}"
        )
    return "\n\n---\n\n".join(lines)


def _call_llm(query: str, chunks: list[dict], customer_name: str) -> dict[str, Any] | None:
    """
    Calls Groq with a strict system prompt and the retrieved context.
    Returns the parsed JSON dict, or None on API failure / parse error.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY is not set — cannot call LLM.")
        return None

    context_block = _build_context_block(chunks)

    user_message = (
        f"Customer Name: {customer_name}\n"
        f"Customer query: {query}\n\n"
        f"Support knowledge base chunks to answer from:\n\n"
        f"{context_block}"
    )

    try:
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.1,
            max_tokens=1024,
            response_format={"type": "json_object"},  # Groq structured output
        )

        raw_content = response.choices[0].message.content.strip()
        parsed = json.loads(raw_content)
        return parsed

    except json.JSONDecodeError as e:
        logger.error(f"LLM returned invalid JSON: {e}")
        return None
    except Exception as e:
        logger.error(f"Groq API call failed: {e}", exc_info=True)
        return None


# ── Citation Validation ───────────────────────────────────────────────────────

def validate_citations(
    cited_chunk_ids: list[str],
    retrieved_chunks: list[dict],
) -> dict[str, Any]:
    """
    Verifies that every chunk ID the LLM cited actually exists in the
    retrieved Top-5, preventing hallucinated citation IDs from reaching the customer.

    Args:
        cited_chunk_ids:  The 'cited_chunk_ids' list from the LLM's JSON response.
        retrieved_chunks: The Top-5 chunks returned by the hybrid search,
                          each containing a 'chunk_point_id' key.

    Returns:
        {'valid': True}
            — All cited IDs are real; safe to auto-send.
        {'valid': False, 'hallucinated_ids': [...]}
            — One or more cited IDs were invented by the LLM.
    """
    real_ids: set[str] = {chunk["chunk_point_id"] for chunk in retrieved_chunks}
    hallucinated: list[str] = [
        cid for cid in cited_chunk_ids if cid not in real_ids
    ]

    if hallucinated:
        logger.warning(
            f"validate_citations: {len(hallucinated)} hallucinated ID(s) detected: {hallucinated}"
        )
        return {"valid": False, "hallucinated_ids": hallucinated}

    return {"valid": True}


# ── Main entry point ──────────────────────────────────────────────────────────

def process_ticket_for_ai_answer(ticket_id: str) -> dict[str, Any]:
    """
    2-Stage HITL gating pipeline for a ticket.

    Returns one of:
        {'action': 'skip'}
            — Latest message not from customer; nothing to answer.

        {'action': 'hitl', 'reason': str, ...extra}
            — One of the gates failed; route to human agent queue.

        {'action': 'auto_send', 'answer': str, 'confidence_score': int,
         'cited_chunk_ids': [...], 'retrieved_chunks': [...]}
            — Both gates passed; caller should validate citations then send.

    The 'retrieved_chunks' field is included in ALL non-skip returns so
    the HITL dashboard can show agents the full context for any outcome.
    """
    retrieved_chunks: list[dict] = []

    # ── Step 1: Generate standalone search query ──────────────────────────────
    query = generate_standalone_query(ticket_id)

    if query is None:
        logger.info(f"Ticket {ticket_id}: skipping — latest message not from customer.")
        return {"action": "skip"}

    logger.info(f"Ticket {ticket_id}: standalone query → {query!r}")

    # ── Stage 1: Vector Distance Gate ────────────────────────────────────────
    try:
        retrieved_chunks = _run_hybrid_search(query)
    except Exception as e:
        logger.error(f"Ticket {ticket_id}: hybrid search failed: {e}", exc_info=True)
        return {
            "action": "hitl",
            "reason": "retrieval_failed",
            "error": str(e),
            "query": query,
            "retrieved_chunks": [],
        }

    if not retrieved_chunks:
        logger.info(f"Ticket {ticket_id}: no chunks retrieved — routing to HITL.")
        return {
            "action": "hitl",
            "reason": "weak_retrieval",
            "max_score": 0.0,
            "query": query,
            "retrieved_chunks": [],
        }

    max_score = max(c["score"] for c in retrieved_chunks)
    logger.info(f"Ticket {ticket_id}: Stage 1 max_score={max_score:.4f} (threshold={VECTOR_SCORE_THRESHOLD})")

    if max_score < VECTOR_SCORE_THRESHOLD:
        return {
            "action": "hitl",
            "reason": "weak_retrieval",
            "max_score": max_score,
            "query": query,
            "retrieved_chunks": retrieved_chunks,
        }

    # ── Stage 2: LLM Confidence Gate ─────────────────────────────────────────
    logger.info(f"Ticket {ticket_id}: Stage 1 passed. Calling LLM...")
    
    # Resolve customer email & name from ticket to personalize the greeting
    customer_email = None
    try:
        ticket_resp = (
            supabase.table("tickets")
            .select("customer_email")
            .eq("id", ticket_id)
            .single()
            .execute()
        )
        if ticket_resp.data:
            customer_email = ticket_resp.data.get("customer_email")
    except Exception as e:
        logger.error(f"Failed to fetch ticket customer_email for ticket_id={ticket_id}: {e}")

    customer_name = get_friendly_name(customer_email)

    llm_response = _call_llm(query, retrieved_chunks, customer_name)

    if llm_response is None:
        return {
            "action": "hitl",
            "reason": "llm_call_failed",
            "query": query,
            "retrieved_chunks": retrieved_chunks,
        }

    answer: str = llm_response.get("answer", "")
    confidence_score: int = llm_response.get("confidence_score", 0)
    cited_chunk_ids: list[str] = llm_response.get("cited_chunk_ids", [])

    logger.info(
        f"Ticket {ticket_id}: Stage 2 confidence_score={confidence_score}/10 "
        f"cited_chunks={len(cited_chunk_ids)} (threshold={LLM_CONFIDENCE_THRESHOLD})"
    )

    # Gate: reject low confidence OR empty citations
    if confidence_score < LLM_CONFIDENCE_THRESHOLD or not cited_chunk_ids:
        return {
            "action": "hitl",
            "reason": "low_confidence_or_no_citations",
            "confidence_score": confidence_score,
            "cited_chunk_ids": cited_chunk_ids,
            "raw_answer": answer,
            "query": query,
            "retrieved_chunks": retrieved_chunks,
        }

    # ── Stage 3: Citation Validation — catch hallucinated chunk IDs ──────────
    citation_result = validate_citations(cited_chunk_ids, retrieved_chunks)

    if not citation_result["valid"]:
        logger.warning(
            f"Ticket {ticket_id}: hallucinated citations detected — overriding to HITL. "
            f"confidence_score was {confidence_score}/10 but citations are invalid."
        )
        return {
            "action": "hitl",
            "reason": "hallucinated_citation",
            "hallucinated_ids": citation_result["hallucinated_ids"],
            "confidence_score": confidence_score,
            "raw_answer": answer,
            "query": query,
            "retrieved_chunks": retrieved_chunks,
        }

    # ── All three checks passed — safe to auto-send ───────────────────────────
    logger.info(
        f"Ticket {ticket_id}: all gates passed (score={confidence_score}/10, "
        f"citations verified). Returning auto_send."
    )
    return {
        "action": "auto_send",
        "answer": answer,
        "confidence_score": confidence_score,
        "cited_chunk_ids": cited_chunk_ids,
        "query": query,
        "retrieved_chunks": retrieved_chunks,
    }


# ── Orchestrator ──────────────────────────────────────────────────────────────

def _insert_hitl_attempt(ticket_id: str, result: dict) -> None:
    """
    Persists a HITL routing event to the hitl_attempts table.
    Extracts whatever fields are available in result — earlier stage failures
    (e.g. weak_retrieval) will have null LLM fields, which is expected.

    Never raises — a logging failure should not block the main pipeline.
    """
    try:
        row = {
            "ticket_id": ticket_id,
            "reason": result.get("reason", "unknown"),
            # LLM fields — only present when Stage 2 was reached
            "attempted_answer": result.get("raw_answer") or result.get("answer"),
            "confidence_score": result.get("confidence_score"),
            # Qdrant retrieval — present whenever Stage 1 ran (even on failure)
            "retrieved_chunks": result.get("retrieved_chunks") or [],
            # Citation fields — only present when LLM responded
            "cited_chunk_ids": result.get("cited_chunk_ids") or [],
            # Hallucination fields — only present on hallucinated_citation reason
            "hallucinated_ids": result.get("hallucinated_ids") or [],
        }
        supabase.table("hitl_attempts").insert(row).execute()
        logger.info(
            f"Ticket {ticket_id}: hitl_attempt recorded "
            f"(reason={row['reason']}, confidence={row['confidence_score']})"
        )
    except Exception as e:
        logger.error(
            f"Ticket {ticket_id}: failed to insert hitl_attempt row: {e}",
            exc_info=True,
        )


def handle_ai_response(ticket_id: str) -> dict[str, Any]:
    """
    Top-level orchestrator: runs the full HITL pipeline and takes action.

    - 'auto_send': calls post_reply() to insert the AI message and dispatch
      the email. The ticket status becomes 'pending' (set inside post_reply).

    - 'hitl': updates the ticket status to 'hitl' in Supabase, inserts a
      hitl_attempts row capturing all available pipeline diagnostics, and stops —
      the agent dashboard will surface it for human review.

    - 'skip': does nothing (latest message wasn't from a customer).

    Returns the full pipeline result dict for logging/task metadata.
    """
    # Import here to avoid a circular import at module load time
    # (reply_service → supabase_client is fine; hitl_gate → reply_service
    #  needs to happen after hitl_gate is fully defined)
    from backend.services.reply_service import post_reply

    result = process_ticket_for_ai_answer(ticket_id)
    action = result.get("action")

    if action == "auto_send":
        logger.info(f"Ticket {ticket_id}: auto_send — posting AI reply.")
        try:
            reply_result = post_reply(
                ticket_id=ticket_id,
                content=result["answer"],
                sender="ai",
            )
            result["reply_result"] = reply_result
            logger.info(
                f"Ticket {ticket_id}: AI reply sent | "
                f"message_id={reply_result['message_id']} | "
                f"email_sent={reply_result['email_sent']}"
            )

            # ── Mark ticket as AI-resolved (only on successful post_reply) ────
            # post_reply() sets status='pending' internally before dispatching the
            # email. We now override that to 'ai_resolved' to distinguish tickets
            # that were fully closed by the AI from those awaiting agent action.
            # This update only runs if post_reply() returned without raising —
            # meaning the ticket_messages row was inserted successfully.
            try:
                supabase.table("tickets").update({
                    "status": "ai_resolved",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", ticket_id).execute()
                logger.info(f"Ticket {ticket_id}: status set to 'ai_resolved'.")
            except Exception as status_exc:
                # Non-fatal: the reply was sent; status update failure is cosmetic.
                # The ticket will remain 'pending' (set by post_reply) and will be
                # visible in the dashboard for manual resolution.
                logger.error(
                    f"Ticket {ticket_id}: AI reply sent but failed to set status='ai_resolved': "
                    f"{status_exc}",
                    exc_info=True,
                )

            if not reply_result.get("email_sent"):
                logger.warning(
                    f"Ticket {ticket_id}: AI reply DB row saved (ai_resolved) "
                    f"but Resend email dispatch failed: {reply_result.get('email_error')}. "
                    f"Customer will not receive the email — agent may need to follow up."
                )

        except Exception as e:
            logger.error(
                f"Ticket {ticket_id}: post_reply() failed after auto_send gate passed: {e}",
                exc_info=True,
            )
            # Don't re-raise — log the failure and fall through.
            # The ticket stays in its current state; the agent can resend manually.
            result["reply_error"] = str(e)

    elif action == "hitl":
        reason = result.get("reason", "unknown")
        logger.info(f"Ticket {ticket_id}: routing to HITL (reason={reason}).")

        # 1. Update ticket status so the dashboard surfaces it
        supabase.table("tickets").update(
            {"status": "hitl"}
        ).eq("id", ticket_id).execute()

        # 2. Persist full diagnostic context for agent review
        _insert_hitl_attempt(ticket_id, result)

    elif action == "skip":
        logger.info(f"Ticket {ticket_id}: skipped — no customer message to answer.")

    return result
