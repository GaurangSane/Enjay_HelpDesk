"""
scripts/debug_kb_sync.py
-------------------------
Runs sync_kb_article_task SYNCHRONOUSLY (bypassing Celery/Redis) for ONE
pending article, so we get the full exception traceback directly in the terminal.

Run from project root:
    python -m scripts.debug_kb_sync
"""
import traceback
import backend.config  # noqa: F401

from backend.db.supabase_client import supabase
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION
from backend.services.tasks import sync_kb_article_task

# Pick the first pending article
resp = supabase.table("kb_articles").select("id, content").eq("sync_status", "pending").limit(1).execute()
rows = resp.data or []

if not rows:
    print("No pending articles found. All may already be synced.")
else:
    row = rows[0]
    aid = row["id"]
    title = row["content"].split("\n")[0][:80]
    print(f"\nTesting sync for: {aid}")
    print(f"Title: \"{title}\"")
    print("-" * 60)

    try:
        # Call the underlying function DIRECTLY (no Celery, full traceback)
        result = sync_kb_article_task.run(aid)
        print(f"\nSUCCESS: {result}")
    except Exception:
        print("\nFAILED — full traceback:")
        traceback.print_exc()

    # Show Qdrant count after
    print("\n" + "-" * 60)
    info = qdrant.get_collection(KB_ARTICLES_COLLECTION)
    print(f"Qdrant '{KB_ARTICLES_COLLECTION}' point count: {info.points_count}")

    # Show pending count after
    pending = supabase.table("kb_articles").select("id", count="exact").eq("sync_status", "pending").execute()
    print(f"Supabase pending rows remaining: {pending.count}")
