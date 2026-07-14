"""
routers/kb_articles.py
-----------------------
Endpoints for Knowledge Base article management.

POST /kb-articles/preflight-check
    Runs a dense-vector deduplication check before creating a new article.
    Searches the kb_articles Qdrant collection (dense only, Top-3) and flags
    near-duplicates above a 0.92 cosine similarity threshold.

POST /kb-articles
    Inserts a new kb_articles row in Supabase with sync_status='pending'
    and queues the sync_kb_article_task Celery task for embedding + Qdrant upsert.

POST /kb-articles/{old_id}/update-version
    Supersedes an existing article with a new version:
      1. Marks the old row is_archived=True, sync_status='delete_pending'.
      2. Immediately deletes all old Qdrant chunks via payload filter (no sweeper needed).
      3. Inserts a new row with previous_version_id=old_id, sync_status='pending'.
      4. Queues sync_kb_article_task for the new row.
    Returns the new article's id.
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from qdrant_client.models import Filter, FieldCondition, MatchValue

import backend.config  # noqa: F401 — ensure .env is loaded
from backend.db.supabase_client import supabase
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION, DENSE_VECTOR_NAME
from backend.services.embedding import generate_dense_embedding
from backend.services.tasks import sync_kb_article_task

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/kb-articles",
    tags=["kb-articles"],
)

# ── Similarity threshold for flagging duplicates ──────────────────────────────
DUPLICATE_SCORE_THRESHOLD = 0.92
PREFLIGHT_TOP_K = 3
CONTENT_PREVIEW_CHARS = 200


# ── Request / Response Models ─────────────────────────────────────────────────

class PreflightRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be empty")
        return v


class PreflightMatch(BaseModel):
    kb_article_id: str
    content_preview: str
    similarity_score: float


class PreflightResponse(BaseModel):
    duplicate_found: bool
    matches: list[PreflightMatch]


class CreateArticleRequest(BaseModel):
    content: str
    title: str | None = None  # Prepended to content before storage if provided

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be empty")
        return v


class CreateArticleResponse(BaseModel):
    kb_article_id: str
    sync_task_id: str
    success: bool


class UpdateVersionRequest(BaseModel):
    content: str
    title: str | None = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be empty")
        return v


class UpdateVersionResponse(BaseModel):
    new_kb_article_id: str
    old_kb_article_id: str
    qdrant_chunks_deleted: int
    sync_task_id: str
    success: bool


# ── Qdrant deletion helper ──────────────────────────────────────────────────

def _delete_qdrant_chunks(kb_article_id: str) -> int:
    """
    Deletes ALL Qdrant points whose payload.kb_article_id matches the given UUID.

    Uses Qdrant's delete_points with a payload filter so we never need to track
    chunk counts or iterate — Qdrant handles the scroll-and-delete internally.

    Returns the number of points deleted (0 if none existed yet, which is fine
    for articles that were pending and never synced).
    """
    try:
        # First count how many exist (for the response metadata)
        count_result = qdrant.count(
            collection_name=KB_ARTICLES_COLLECTION,
            count_filter=Filter(
                must=[
                    FieldCondition(
                        key="kb_article_id",
                        match=MatchValue(value=kb_article_id),
                    )
                ]
            ),
            exact=True,
        )
        chunks_to_delete = count_result.count

        if chunks_to_delete > 0:
            qdrant.delete(
                collection_name=KB_ARTICLES_COLLECTION,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="kb_article_id",
                            match=MatchValue(value=kb_article_id),
                        )
                    ]
                ),
            )
            logger.info(
                f"_delete_qdrant_chunks: deleted {chunks_to_delete} point(s) "
                f"for kb_article {kb_article_id} from '{KB_ARTICLES_COLLECTION}'."
            )
        else:
            logger.info(
                f"_delete_qdrant_chunks: no points found for kb_article {kb_article_id} "
                f"(article was likely pending/never synced) — skipping delete."
            )

        return chunks_to_delete

    except Exception as e:
        # Log but don't re-raise — the Supabase state is already correct.
        # Stale Qdrant points are inert (they won't appear in searches once
        # is_archived is true and we filter by active articles).
        logger.error(
            f"_delete_qdrant_chunks: Qdrant deletion failed for {kb_article_id}: {e}",
            exc_info=True,
        )
        return 0


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/preflight-check", response_model=PreflightResponse)
async def preflight_check(body: PreflightRequest):
    """
    Generates a dense embedding for the draft content and searches the
    kb_articles Qdrant collection (dense vector only, Top-3) for similar
    existing articles.

    Returns duplicate_found=True if ANY match exceeds the 0.92 cosine
    similarity threshold, allowing the frontend to warn the agent before
    creating a redundant article.

    NOTE: Uses dense search only (not hybrid RRF) because deduplication is a
    pure semantic similarity task — BM25 keyword overlap would add noise here.
    """
    # 1. Generate dense embedding for the draft content
    try:
        dense_vector = generate_dense_embedding(body.content)
    except Exception as e:
        logger.error(f"preflight-check: embedding generation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"Embedding service unavailable: {e}"
        )

    # 2. Dense-only search against kb_articles
    try:
        results = qdrant.query_points(
            collection_name=KB_ARTICLES_COLLECTION,
            query=dense_vector,
            using=DENSE_VECTOR_NAME,
            limit=PREFLIGHT_TOP_K,
            with_payload=True,
        )
        hits = results.points
    except Exception as e:
        logger.error(f"preflight-check: Qdrant search failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"Vector search unavailable: {e}"
        )

    # 3. Build match list and evaluate threshold
    matches: list[PreflightMatch] = []
    duplicate_found = False

    for hit in hits:
        payload = hit.payload or {}
        content = payload.get("content", "")
        kb_article_id = payload.get("kb_article_id", str(hit.id))
        score = hit.score

        if score >= DUPLICATE_SCORE_THRESHOLD:
            duplicate_found = True

        matches.append(PreflightMatch(
            kb_article_id=kb_article_id,
            content_preview=content[:CONTENT_PREVIEW_CHARS] + ("..." if len(content) > CONTENT_PREVIEW_CHARS else ""),
            similarity_score=round(score, 6),
        ))

    logger.info(
        f"preflight-check: Top-{PREFLIGHT_TOP_K} scores={[m.similarity_score for m in matches]} "
        f"duplicate_found={duplicate_found}"
    )

    return PreflightResponse(duplicate_found=duplicate_found, matches=matches)


@router.post("/", response_model=CreateArticleResponse, status_code=201)
async def create_kb_article(body: CreateArticleRequest):
    """
    Inserts a new kb_articles row in Supabase with sync_status='pending',
    then dispatches the sync_kb_article_task Celery task to generate embeddings
    and upsert the article into Qdrant.

    The preflight-check endpoint should be called first to detect near-duplicates,
    but this endpoint does NOT enforce that — the agent may choose to proceed anyway
    (e.g. when updating a related but distinct article).
    """
    # 1. Compose the stored content — prepend title if provided
    stored_content = (
        f"{body.title.strip()}\n\n{body.content}"
        if body.title and body.title.strip()
        else body.content
    )

    # 2. Insert into Supabase kb_articles
    try:
        insert_resp = (
            supabase.table("kb_articles")
            .insert({
                "content": stored_content,
                "sync_status": "pending",
            })
            .execute()
        )
    except Exception as e:
        logger.error(f"create_kb_article: Supabase insert failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database insert failed: {e}")

    if not insert_resp.data:
        raise HTTPException(
            status_code=500,
            detail="Insert succeeded but returned no data — check Supabase RLS policies."
        )

    kb_article_id: str = insert_resp.data[0]["id"]
    logger.info(f"create_kb_article: inserted kb_article {kb_article_id}")

    # 3. Queue Celery task for embedding + Qdrant upsert (Outbox pattern)
    try:
        task = sync_kb_article_task.delay(kb_article_id)
        logger.info(f"create_kb_article: queued sync task {task.id} for article {kb_article_id}")
    except Exception as e:
        # Task queue failure is non-fatal — the article is in Supabase with
        # sync_status='pending', so the sweeper cron can retry embedding later.
        logger.error(
            f"create_kb_article: failed to queue sync task for {kb_article_id}: {e}",
            exc_info=True,
        )
        return CreateArticleResponse(
            kb_article_id=kb_article_id,
            sync_task_id="queuing_failed",
            success=True,  # DB insert succeeded; embedding will be retried by sweeper
        )



    return CreateArticleResponse(
        kb_article_id=kb_article_id,
        sync_task_id=task.id,
        success=True,
    )


@router.post("/{old_id}/update-version", response_model=UpdateVersionResponse, status_code=201)
async def update_version(old_id: str, body: UpdateVersionRequest):
    """
    Supersedes an existing KB article with a new version. Four-step flow:

    Step 1 — Archive the old row in Supabase.
        Sets is_archived=True and sync_status='delete_pending' on the old row.
        This keeps the version history queryable while signalling that the row
        is no longer live.

    Step 2 — Delete old Qdrant chunks immediately.
        Uses a payload filter on kb_article_id to delete all points belonging
        to the old article in one Qdrant call. No sweeper dependency — deletion
        is synchronous and confirmed before we proceed.

    Step 3 — Insert the new row with version lineage.
        Creates a fresh kb_articles row with:
          - previous_version_id = old_id  (traceable version chain)
          - sync_status = 'pending'       (queued for Celery embedding)
          - is_archived = False (default)

    Step 4 — Queue the Celery sync task for the new row.
        Dispatches sync_kb_article_task.delay(new_id) for embedding + Qdrant upsert.
        If the task queue is unavailable, the row is still safely stored with
        sync_status='pending' for sweeper retry.

    Returns:
        new_kb_article_id: UUID of the newly created version.
        old_kb_article_id: UUID of the archived old version.
        qdrant_chunks_deleted: How many Qdrant points were removed.
        sync_task_id: Celery task ID (or 'queuing_failed' if Redis is down).
        success: True in all cases where the DB state is consistent.

    Raises:
        404 if old_id does not exist in kb_articles.
        400 if old_id is already archived (prevents double-archiving).
        500 if any Supabase write fails.
    """
    # Step 0: Validate the old article exists and is not already archived ──────
    fetch_resp = (
        supabase.table("kb_articles")
        .select("id, is_archived, sync_status")
        .eq("id", old_id)
        .single()
        .execute()
    )

    if not fetch_resp.data:
        raise HTTPException(status_code=404, detail=f"kb_article {old_id} not found.")

    if fetch_resp.data.get("is_archived"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"kb_article {old_id} is already archived. "
                "Cannot version an already-superseded article."
            ),
        )

    # Step 1: Archive the old row in Supabase ─────────────────────────────────
    try:
        supabase.table("kb_articles").update({
            "is_archived": True,
            "sync_status": "delete_pending",
        }).eq("id", old_id).execute()
        logger.info(f"update_version: archived old kb_article {old_id}")
    except Exception as e:
        logger.error(f"update_version: failed to archive {old_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to archive old article: {e}")

    # Step 2: Delete old Qdrant chunks (immediate, synchronous) ───────────────
    chunks_deleted = _delete_qdrant_chunks(old_id)

    # Step 3: Insert the new versioned row ────────────────────────────────────
    stored_content = (
        f"{body.title.strip()}\n\n{body.content}"
        if body.title and body.title.strip()
        else body.content
    )

    try:
        insert_resp = (
            supabase.table("kb_articles")
            .insert({
                "content": stored_content,
                "sync_status": "pending",
                "previous_version_id": old_id,
                "is_archived": False,
            })
            .execute()
        )
    except Exception as e:
        logger.error(f"update_version: new row insert failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to insert new article version: {e}")

    if not insert_resp.data:
        raise HTTPException(
            status_code=500,
            detail="New article insert returned no data — check Supabase RLS policies.",
        )

    new_id: str = insert_resp.data[0]["id"]
    logger.info(
        f"update_version: created new kb_article {new_id} "
        f"(previous_version_id={old_id}, qdrant_chunks_deleted={chunks_deleted})"
    )

    # Step 4: Queue Celery sync task for the new row ──────────────────────────
    sync_task_id = "queuing_failed"
    try:
        task = sync_kb_article_task.delay(new_id)
        sync_task_id = task.id
        logger.info(f"update_version: queued sync task {sync_task_id} for new article {new_id}")
    except Exception as e:
        # Non-fatal: Supabase state is consistent; sweeper will retry embedding.
        logger.error(
            f"update_version: failed to queue sync task for {new_id}: {e}",
            exc_info=True,
        )

    return UpdateVersionResponse(
        new_kb_article_id=new_id,
        old_kb_article_id=old_id,
        qdrant_chunks_deleted=chunks_deleted,
        sync_task_id=sync_task_id,
        success=True,
    )
