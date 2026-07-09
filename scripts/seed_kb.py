"""
scripts/seed_kb.py
------------------
One-time script to seed the kb_articles table in Supabase from seed_kb_articles.json
and queue each article for Qdrant embedding via the sync_kb_article_task Celery task.

Run from the backend/ directory:
    python ../scripts/seed_kb.py

Requirements: .env file must be present and Celery/Redis must be running.
"""

import os
import sys
import json
import time
import logging
from pathlib import Path

# ── Make sure backend/ is on sys.path so we can import backend modules ──────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(dotenv_path=BACKEND_DIR / ".env")

from db.supabase_client import supabase
from services.tasks import sync_kb_article_task

# ── Config ───────────────────────────────────────────────────────────────────
SEED_FILE = SCRIPT_DIR.parent / "seed_kb_articles.json"

# Google text-embedding-004 allows ~1500 RPM on the free tier.
# We embed 1 article at a time (potentially multiple chunks), so 1 article
# every 2 seconds gives us comfortable headroom at ~30 RPM batch rate.
BATCH_SIZE = 1       # Insert and queue N articles before pausing
BATCH_DELAY_SEC = 15  # Seconds to pause between batches

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("seed_kb")


def load_articles() -> list[dict]:
    if not SEED_FILE.exists():
        logger.error(f"Seed file not found: {SEED_FILE}")
        sys.exit(1)
    with open(SEED_FILE, "r", encoding="utf-8") as f:
        articles = json.load(f)
    logger.info(f"Loaded {len(articles)} articles from {SEED_FILE.name}")
    return articles


def insert_article(article: dict) -> str | None:
    """
    Inserts a single kb_article row into Supabase with sync_status='pending'.
    Returns the new row's UUID, or None on failure.
    """
    try:
        response = supabase.table("kb_articles").insert({
            "content": f"{article['title']}\n\n{article['content']}",
            "sync_status": "pending",
        }).execute()

        if not response.data:
            logger.error(f"Insert returned no data for article: {article['title']!r}")
            return None

        kb_article_id = response.data[0]["id"]
        logger.info(f"  ✔ Inserted: {article['title']!r} → {kb_article_id}")
        return kb_article_id

    except Exception as e:
        logger.error(f"  ✘ Failed to insert {article['title']!r}: {e}")
        return None


def queue_embedding(kb_article_id: str, title: str) -> None:
    """
    Dispatches the sync_kb_article_task Celery task for embedding and Qdrant upsert.
    """
    try:
        task = sync_kb_article_task.delay(kb_article_id)
        logger.info(f"  ✔ Queued embedding task: {task.id} for article {kb_article_id}")
    except Exception as e:
        logger.error(f"  ✘ Failed to queue task for {kb_article_id} ({title!r}): {e}")


def seed():
    articles = load_articles()
    total = len(articles)
    queued_ids = []
    failed_titles = []

    logger.info(f"Starting seed: {total} articles | batch_size={BATCH_SIZE} | delay={BATCH_DELAY_SEC}s between batches")
    logger.info("=" * 70)

    for i, article in enumerate(articles, start=1):
        logger.info(f"[{i}/{total}] Processing: {article.get('title', 'Untitled')!r}")

        kb_article_id = insert_article(article)

        if kb_article_id:
            queue_embedding(kb_article_id, article.get("title", ""))
            queued_ids.append(kb_article_id)
        else:
            failed_titles.append(article.get("title", f"Article #{i}"))

        # Pause between batches to avoid overwhelming the embedding API
        if i % BATCH_SIZE == 0 and i < total:
            logger.info(f"  ── Batch of {BATCH_SIZE} complete. Pausing {BATCH_DELAY_SEC}s to respect rate limits... ──")
            time.sleep(BATCH_DELAY_SEC)

    # ── Summary ──────────────────────────────────────────────────────────────
    logger.info("=" * 70)
    logger.info(f"Seed complete.")
    logger.info(f"  ✔ Successfully inserted and queued : {len(queued_ids)}/{total}")
    if failed_titles:
        logger.warning(f"  ✘ Failed articles ({len(failed_titles)}):")
        for title in failed_titles:
            logger.warning(f"      - {title}")
    logger.info("Monitor Celery worker logs for embedding progress.")


if __name__ == "__main__":
    seed()
