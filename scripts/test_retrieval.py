"""
scripts/test_retrieval.py
--------------------------
Manual evaluation script for the kb_articles Qdrant hybrid search pipeline.

Performs Hybrid Search (dense cosine + sparse BM25) against the kb_articles
collection using Qdrant's query_points API with Prefetch + RRF Fusion, then
prints the Top-5 results with scores for qualitative evaluation.

Run from the project root:
    python scripts/test_retrieval.py
    python scripts/test_retrieval.py "your custom query here"
"""

import os
import sys
import textwrap
from pathlib import Path

# ── Ensure backend/ modules are importable ───────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(dotenv_path=BACKEND_DIR / ".env")

from qdrant_client import models
from backend.db.qdrant_client import qdrant, KB_ARTICLES_COLLECTION
from backend.services.embedding import generate_dense_embedding, generate_sparse_embedding

# ── Configuration ─────────────────────────────────────────────────────────────
DEFAULT_QUERY = "I'm getting error SNG-4021 when syncing my CRM data"
TOP_K = 5
PREFETCH_LIMIT = 20     # Candidates retrieved per vector type before fusion
CONTENT_PREVIEW_LEN = 500  # Characters to display from each result's content


def hybrid_search(query: str, top_k: int = TOP_K) -> list:
    """
    Performs hybrid search against kb_articles using:
      1. Dense vector search (Google text-embedding-004, 768-dim cosine)
      2. Sparse vector search (fastembed BM25 keyword matching)
      3. Reciprocal Rank Fusion (RRF) to re-rank and merge both result lists.

    Args:
        query: Natural language search query.
        top_k: Number of final results to return after fusion.

    Returns:
        List of Qdrant ScoredPoint objects.
    """
    print(f"\n{'='*70}")
    print(f"  QUERY: {query!r}")
    print(f"{'='*70}\n")

    # Step 1: Generate both embeddings for the query
    print("⏳ Generating dense embedding (Google text-embedding-004)...")
    dense_vector = generate_dense_embedding(query)
    print(f"   ✔ Dense vector: 768-dim (first 5 values: {dense_vector[:5]})")

    print("⏳ Generating sparse embedding (fastembed BM25)...")
    sparse_vector = generate_sparse_embedding(query)
    print(f"   ✔ Sparse vector: {len(sparse_vector['indices'])} non-zero terms")

    # Step 2: Hybrid search — Prefetch from both vector spaces, fuse with RRF
    print(f"\n🔍 Searching '{KB_ARTICLES_COLLECTION}' collection (Top-{top_k} via RRF)...\n")
    results = qdrant.query_points(
        collection_name=KB_ARTICLES_COLLECTION,
        prefetch=[
            # Dense candidate pool
            models.Prefetch(
                query=dense_vector,
                using="dense",
                limit=PREFETCH_LIMIT,
            ),
            # Sparse candidate pool (BM25 keyword matching)
            models.Prefetch(
                query=models.SparseVector(
                    indices=sparse_vector["indices"],
                    values=sparse_vector["values"],
                ),
                using="sparse",
                limit=PREFETCH_LIMIT,
            ),
        ],
        # Reciprocal Rank Fusion merges both ranked lists into one final ranking
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=top_k,
        with_payload=True,
    )
    return results.points


def print_results(results: list, query: str) -> None:
    """Pretty-prints the hybrid search results for manual evaluation."""
    if not results:
        print("⚠️  No results returned. Is the collection populated? Run seed_kb.py first.")
        return

    print(f"{'='*70}")
    print(f"  TOP-{len(results)} HYBRID SEARCH RESULTS")
    print(f"  Query: {query!r}")
    print(f"{'='*70}\n")

    for rank, hit in enumerate(results, start=1):
        payload = hit.payload or {}
        content = payload.get("content", "[No content in payload]")

        # Truncate long content for readability
        preview = content[:CONTENT_PREVIEW_LEN]
        if len(content) > CONTENT_PREVIEW_LEN:
            preview += "..."

        # Indent the content block for clean visual separation
        indented_preview = textwrap.indent(preview, prefix="    ")

        print(f"┌─ #{rank}  Score: {hit.score:.6f}  │  Point ID: {hit.id}")
        print(f"│  kb_article_id : {payload.get('kb_article_id', 'N/A')}")
        print(f"│  chunk_index   : {payload.get('chunk_index', 'N/A')}")
        print(f"│  emb_model     : {payload.get('embedding_model_version', 'N/A')}")
        print(f"│")
        print(f"│  Content Preview:")
        print(indented_preview)
        print(f"└{'─'*68}\n")

    print("✅ Retrieval complete. Evaluate the results above for relevance accuracy.")
    print("   Tip: High-scoring results should semantically match the query intent,")
    print("   not just share keywords (that validates the dense vector is working).")


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUERY
    results = hybrid_search(query)
    print_results(results, query)


if __name__ == "__main__":
    main()
