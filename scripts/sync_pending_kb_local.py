"""
scripts/sync_pending_kb_local.py
----------------------------------
Runs sync_kb_article_task.run() LOCALLY (no Celery broker) for every
kb_articles row with sync_status='pending'.

Use this when the Railway Celery worker is not processing queued tasks.

Run from project root:
    python -m scripts.sync_pending_kb_local
"""
import time
import traceback
import backend.config  # noqa: F401

from backend.db.supabase_client import supabase
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION
from backend.services.tasks import sync_kb_article_task

def main():
    resp = supabase.table("kb_articles").select("id, content").eq("sync_status", "pending").execute()
    rows = resp.data or []
    total = len(rows)

    if not total:
        print("No pending articles. All already synced.")
        return

    print(f"\nFound {total} pending articles. Running sync locally...\n")
    succeeded, failed = [], []

    for i, row in enumerate(rows, 1):
        aid = row["id"]
        title = row["content"].split("\n")[0][:70]
        print(f"[{i}/{total}] {aid}")
        print(f"       \"{title}\"")
        try:
            result = sync_kb_article_task.run(aid)
            print(f"       SUCCESS: {result}\n")
            succeeded.append(aid)
        except Exception:
            print(f"       FAILED:\n")
            traceback.print_exc()
            failed.append(aid)
            print()
        # Brief pause to respect Google embedding API rate limits
        if i < total:
            time.sleep(2)

    # Final counts
    info = qdrant.get_collection(KB_ARTICLES_COLLECTION)
    pending_resp = supabase.table("kb_articles").select("id", count="exact").eq("sync_status", "pending").execute()

    print("=" * 60)
    print(f"Done. Succeeded: {len(succeeded)}/{total}  |  Failed: {len(failed)}/{total}")
    print(f"Qdrant '{KB_ARTICLES_COLLECTION}' point count: {info.points_count}")
    print(f"Supabase pending rows remaining: {pending_resp.count}")
    if failed:
        print(f"\nFailed IDs:")
        for fid in failed:
            print(f"  {fid}")

if __name__ == "__main__":
    main()
