"""
scripts/init_qdrant_collections.py
------------------------------------
One-off migration script: creates BOTH Qdrant collections in the cloud cluster
using the EXACT same hybrid-search schema as the original local Docker setup.

Schema (matches backend/db/qdrant_client.py exactly):
  - Dense named vector  : name="dense", size=768, distance=COSINE
                          (Google text-embedding-004 output)
  - Sparse named vector : name="sparse", SparseIndexParams(on_disk=False)
                          (BM25-style keyword matching, kept in memory)

Collections created:
  1. kb_articles           -- knowledge-base RAG retrieval
  2. ticket_messages_index -- past-ticket similarity search

Run from the PROJECT ROOT:
    python -m scripts.init_qdrant_collections

Requirements: backend/.env must have QDRANT_URL and QDRANT_API_KEY set.
"""

import os
import sys
import logging

# -- Load backend/.env via config.py (absolute-path-aware) --------------------
import backend.config  # noqa: F401 -- side-effect: loads backend/.env

from backend.db.qdrant_client import (
    qdrant,
    KB_ARTICLES_COLLECTION,
    TICKET_MESSAGES_COLLECTION,
    DENSE_VECTOR_NAME,
    DENSE_VECTOR_SIZE,
    SPARSE_VECTOR_NAME,
)
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("init_qdrant_collections")

COLLECTIONS = [KB_ARTICLES_COLLECTION, TICKET_MESSAGES_COLLECTION]


def create_collection(name: str) -> None:
    """
    Idempotently create a hybrid-search Qdrant collection.
    Skips creation if the collection already exists.
    """
    existing = [c.name for c in qdrant.get_collections().collections]

    if name in existing:
        logger.info("  [OK] Collection '%s' already exists -- skipping.", name)
        return

    qdrant.create_collection(
        collection_name=name,
        vectors_config={
            DENSE_VECTOR_NAME: VectorParams(
                size=DENSE_VECTOR_SIZE,
                distance=Distance.COSINE,
            ),
        },
        sparse_vectors_config={
            SPARSE_VECTOR_NAME: SparseVectorParams(
                index=SparseIndexParams(
                    on_disk=False,  # Keep BM25 index in memory for fast lookups
                ),
            ),
        },
    )
    logger.info(
        "  [CREATED] '%s' -- dense(%dd, COSINE) + sparse(BM25, in-memory)",
        name,
        DENSE_VECTOR_SIZE,
    )


def verify_collections() -> None:
    """Log point counts for all target collections as a sanity check."""
    logger.info("-- Verification ---------------------------------------------")
    for name in COLLECTIONS:
        try:
            info = qdrant.get_collection(name)
            count = info.points_count
            logger.info("  %s: %s points", name, count)
        except Exception as e:
            logger.error("  %s: could not verify -- %s", name, e)


def main() -> None:
    logger.info("=" * 60)
    logger.info("Qdrant Cloud -- collection initialisation")
    logger.info("=" * 60)

    url = os.environ.get("QDRANT_URL", "http://localhost:6333")
    key = os.environ.get("QDRANT_API_KEY", "")
    if len(key) > 10:
        masked_key = key[:6] + "..." + key[-4:]
    elif key:
        masked_key = key
    else:
        masked_key = "<none>"
    logger.info("Target URL : %s", url)
    logger.info("API Key    : %s", masked_key)
    logger.info("-" * 60)

    for collection_name in COLLECTIONS:
        logger.info("Processing: %s", collection_name)
        try:
            create_collection(collection_name)
        except Exception as exc:
            logger.error("  [FAIL] Could not create '%s': %s", collection_name, exc)
            sys.exit(1)

    verify_collections()

    logger.info("=" * 60)
    logger.info("Done -- both collections are ready in Qdrant Cloud.")
    logger.info("Next step: run  python -m scripts.seed_kb")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
