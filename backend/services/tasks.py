import uuid
import logging
from backend.celery_app import celery_app
from backend.db.supabase_client import supabase
from backend.db.qdrant_client import KB_ARTICLES_COLLECTION, TICKET_MESSAGES_COLLECTION
from backend.services.chunking import chunk_text
from backend.services.sanitize import sanitize_for_llm
from backend.services.embedding import generate_dense_embedding, generate_sparse_embedding, upsert_to_qdrant

logger = logging.getLogger(__name__)

EMBEDDING_MODEL_VERSION = "gemini-embedding-001"

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _extract_clean_text(sanitized: str) -> str:
    """
    Strips the <user_content>...</user_content> delimiters from sanitize_for_llm output
    to get the clean text for embedding (delimiters are for LLM prompts, not vector math).
    """
    return (
        sanitized
        .replace("<user_content>", "")
        .replace("</user_content>", "")
        .strip()
    )


def _deterministic_chunk_id(base_uuid: str, chunk_index: int) -> str:
    """
    Generates a deterministic UUID5 from a base UUID + chunk_index.
    Ensures each chunk has a stable, unique Qdrant point ID that never collides
    across retries (upsert is idempotent with the same ID).
    """
    namespace = uuid.UUID(base_uuid)
    return str(uuid.uuid5(namespace, str(chunk_index)))


# ---------------------------------------------------------------------------
# Task 1: Sync a ticket_message into ticket_messages_index
# ---------------------------------------------------------------------------

@celery_app.task(
    name="services.tasks.sync_ticket_message_task",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def sync_ticket_message_task(self, ticket_message_id: str):
    """
    Fetches a ticket_message from Supabase, sanitizes, chunks, embeds,
    and upserts each chunk into the ticket_messages_index Qdrant collection.

    No Outbox sync_status tracking needed — ticket_messages table has no such column.
    Retries up to 3 times on transient failures (embedding API errors, Qdrant timeouts).
    """
    logger.info(f"Processing ticket_message: {ticket_message_id}")

    try:
        # 1. Fetch message content from Supabase
        response = supabase.table("ticket_messages").select("id, content").eq("id", ticket_message_id).single().execute()
        if not response.data:
            logger.error(f"ticket_message {ticket_message_id} not found in Supabase. Skipping.")
            return {"status": "skipped", "reason": "not_found"}

        raw_content: str = response.data["content"]

        # 2. Sanitize (removes injection patterns) then extract clean text for embedding
        sanitized = sanitize_for_llm(raw_content)
        clean_text = _extract_clean_text(sanitized)

        if not clean_text or clean_text.startswith("["):
            logger.warning(f"ticket_message {ticket_message_id} had empty or placeholder content after sanitization.")
            return {"status": "skipped", "reason": "empty_content"}

        # 3. Chunk the content (format-agnostic sentence splitter)
        chunks = chunk_text(clean_text)
        if not chunks:
            logger.warning(f"No chunks produced for ticket_message {ticket_message_id}.")
            return {"status": "skipped", "reason": "no_chunks"}

        # 4. Embed and upsert each chunk into ticket_messages_index
        for chunk in chunks:
            chunk_point_id = _deterministic_chunk_id(ticket_message_id, chunk["chunk_index"])

            dense = generate_dense_embedding(chunk["content"])
            sparse = generate_sparse_embedding(chunk["content"])

            upsert_to_qdrant(
                collection_name=TICKET_MESSAGES_COLLECTION,
                point_id=chunk_point_id,
                dense_vector=dense,
                sparse_vector=sparse,
                payload={
                    "ticket_message_id": ticket_message_id,
                    "chunk_index": chunk["chunk_index"],
                    "content": chunk["content"],
                },
            )

        logger.info(
            f"sync_ticket_message_task: successfully upserted {len(chunks)} chunk(s) "
            f"for ticket_message {ticket_message_id} into '{TICKET_MESSAGES_COLLECTION}'."
        )
        return {"status": "success", "chunks_upserted": len(chunks)}

    except Exception as exc:
        logger.error(f"sync_ticket_message_task failed for {ticket_message_id}: {exc}", exc_info=True)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task 2: Sync a kb_article into kb_articles collection (Outbox pattern)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="services.tasks.sync_kb_article_task",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def sync_kb_article_task(self, kb_article_id: str):
    """
    Fetches a kb_article from Supabase, sanitizes, chunks, embeds,
    and upserts each chunk into the kb_articles Qdrant collection.

    Follows the Outbox pattern:
      - On success: updates Supabase kb_articles.sync_status = 'synced'.
      - On failure: leaves sync_status = 'pending' so the sweeper cron retries it.
    """
    logger.info(f"Processing kb_article: {kb_article_id}")

    try:
        # 1. Fetch article from Supabase
        response = (
            supabase.table("kb_articles")
            .select("id, content, embedding_model_version, is_archived")
            .eq("id", kb_article_id)
            .single()
            .execute()
        )

        if not response.data:
            logger.error(f"kb_article {kb_article_id} not found in Supabase. Skipping.")
            return {"status": "skipped", "reason": "not_found"}

        article = response.data

        # Skip archived articles — they should not be in the active search index
        if article.get("is_archived"):
            logger.info(f"kb_article {kb_article_id} is archived — skipping embedding.")
            return {"status": "skipped", "reason": "archived"}

        raw_content: str = article["content"]

        # 2. Sanitize and extract clean text
        sanitized = sanitize_for_llm(raw_content)
        clean_text = _extract_clean_text(sanitized)

        if not clean_text or clean_text.startswith("["):
            logger.warning(f"kb_article {kb_article_id} had empty or placeholder content after sanitization.")
            return {"status": "skipped", "reason": "empty_content"}

        # 3. Chunk the content
        chunks = chunk_text(clean_text)
        if not chunks:
            logger.warning(f"No chunks produced for kb_article {kb_article_id}.")
            return {"status": "skipped", "reason": "no_chunks"}

        # 4. Embed and upsert each chunk into kb_articles collection
        for chunk in chunks:
            chunk_point_id = _deterministic_chunk_id(kb_article_id, chunk["chunk_index"])

            dense = generate_dense_embedding(chunk["content"])
            sparse = generate_sparse_embedding(chunk["content"])

            upsert_to_qdrant(
                collection_name=KB_ARTICLES_COLLECTION,
                point_id=chunk_point_id,
                dense_vector=dense,
                sparse_vector=sparse,
                payload={
                    "kb_article_id": kb_article_id,
                    "chunk_index": chunk["chunk_index"],
                    "content": chunk["content"],
                    "embedding_model_version": EMBEDDING_MODEL_VERSION,
                },
            )

        # 5. Outbox: mark synced in Supabase ONLY after all Qdrant upserts succeed
        supabase.table("kb_articles").update({
            "sync_status": "synced",
            "embedding_model_version": EMBEDDING_MODEL_VERSION,
        }).eq("id", kb_article_id).execute()

        logger.info(
            f"sync_kb_article_task: successfully upserted {len(chunks)} chunk(s) "
            f"for kb_article {kb_article_id} into '{KB_ARTICLES_COLLECTION}'."
        )
        return {"status": "success", "chunks_upserted": len(chunks)}

    except Exception as exc:
        # Leave sync_status = 'pending' — sweeper cron will retry
        logger.error(f"sync_kb_article_task failed for {kb_article_id}: {exc}", exc_info=True)
        raise self.retry(exc=exc)
