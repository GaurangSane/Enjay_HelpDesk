"""
scripts/retry_pending_kb.py
----------------------------
Re-triggers sync_kb_article_task for every kb_articles row with sync_status='pending'.
Run from the project root:
    python -m scripts.retry_pending_kb
"""
import backend.config  # noqa: F401 -- loads backend/.env

from backend.db.supabase_client import supabase
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION
from backend.services.tasks import sync_kb_article_task

# 1. Fetch all pending rows
resp = supabase.table("kb_articles").select("id, content").eq("sync_status", "pending").execute()
rows = resp.data or []
print(f"\nFound {len(rows)} pending articles.\n")

if not rows:
    print("Nothing to retry.")
else:
    for row in rows:
        aid = row["id"]
        title = row["content"].split("\n")[0][:80]
        task = sync_kb_article_task.delay(aid)
        print(f"  Queued  {aid}  task={task.id}")
        print(f"          \"{title}\"")

    print(f"\nAll {len(rows)} tasks dispatched to Celery.")

# 2. Current Qdrant point count (before workers finish)
info = qdrant.get_collection(KB_ARTICLES_COLLECTION)
print(f"\nQdrant '{KB_ARTICLES_COLLECTION}' current point count: {info.points_count}")
print("(Re-run after ~60s to see the updated count once workers finish)\n")
