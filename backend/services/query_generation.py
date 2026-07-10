"""
services/query_generation.py
-----------------------------
Converts a multi-turn ticket conversation into a single, standalone search
query optimised for RAG retrieval against the kb_articles Qdrant collection.

Key logic:
  - Only triggers retrieval when the LATEST message sender is 'customer'.
    If the latest sender is 'agent' or 'ai', returns None — nothing new to answer.
  - With a single message: returns the content directly (no LLM round-trip needed).
  - With 2+ messages (up to last 3): calls Groq llama-3.3-70b-versatile to
    rewrite the conversation thread into one self-contained technical query.
"""

import os
import logging
from groq import Groq
from backend.db.supabase_client import supabase

logger = logging.getLogger(__name__)

GROQ_MODEL = "llama-3.3-70b-versatile"
MAX_CONTEXT_MESSAGES = 3  # Only look at the tail of the conversation


_SYSTEM_PROMPT = """You are a support query reformulator.
Your job is to read a short customer support conversation and rewrite it as a
single, self-contained technical search query.

Rules:
- Focus exclusively on the customer's current technical problem or error.
- Ignore greetings, pleasantries, confirmations ("yes", "ok", "thanks"), and
  agent boilerplate ("How can I help you today?").
- Preserve specific error codes, product names, and version numbers exactly.
- Output ONLY the rewritten query — no explanation, no preamble, no quotes.
- The query should be under 50 words.
"""


def _format_conversation(messages: list[dict]) -> str:
    """Formats the last N messages into a readable conversation block for the LLM."""
    lines = []
    for msg in messages:
        sender = msg.get("sender", "unknown").upper()
        content = msg.get("content", "").strip()
        lines.append(f"[{sender}]: {content}")
    return "\n".join(lines)


def generate_standalone_query(ticket_id: str) -> str | None:
    """
    Generates a standalone search query from a ticket's recent conversation.

    Args:
        ticket_id: UUID of the ticket to process.

    Returns:
        - None: if the latest message sender is NOT 'customer' (nothing new to answer).
        - str: the rewritten standalone search query.
    """
    # 1. Fetch the last MAX_CONTEXT_MESSAGES messages, ordered by created_at descending
    #    (we fetch newest first so we can check the latest sender cheaply, then reverse)
    response = (
        supabase.table("ticket_messages")
        .select("id, sender, content, created_at")
        .eq("ticket_id", ticket_id)
        .order("created_at", desc=True)
        .limit(MAX_CONTEXT_MESSAGES)
        .execute()
    )

    if not response.data:
        logger.warning(f"No messages found for ticket {ticket_id}. Skipping query generation.")
        return None

    # Newest-first list from Supabase
    messages_desc = response.data

    # 2. Gate: only proceed if the LATEST (index 0) message is from the customer
    latest_sender = messages_desc[0].get("sender")
    if latest_sender != "customer":
        logger.info(
            f"Ticket {ticket_id}: latest message is from '{latest_sender}'. "
            "Skipping retrieval — no new customer input to answer."
        )
        return None

    # Reverse to chronological order for LLM context readability
    messages_asc = list(reversed(messages_desc))

    # 3. Single-message fast path — no LLM call needed
    if len(messages_asc) == 1:
        standalone_query = messages_asc[0]["content"].strip()
        logger.info(f"Ticket {ticket_id}: single message, returning content directly.")
        return standalone_query

    # 4. Multi-message path — call Groq to rewrite the thread
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY is not set. Cannot rewrite conversation.")
        # Graceful fallback: return just the latest customer message as-is
        return messages_desc[0]["content"].strip()

    conversation_block = _format_conversation(messages_asc)

    logger.info(
        f"Ticket {ticket_id}: rewriting {len(messages_asc)}-message thread with Groq {GROQ_MODEL}."
    )

    client = Groq(api_key=api_key)
    chat_response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Rewrite the following support conversation into a single standalone "
                    "search query that captures the customer's technical problem:\n\n"
                    f"{conversation_block}"
                ),
            },
        ],
        temperature=0.1,   # Low temperature for deterministic, focused rewriting
        max_tokens=100,    # A standalone query never needs more than ~50-100 tokens
    )

    standalone_query = chat_response.choices[0].message.content.strip()
    logger.info(f"Ticket {ticket_id}: rewritten query → {standalone_query!r}")
    return standalone_query
