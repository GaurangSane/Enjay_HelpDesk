import logging
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
)

logger = logging.getLogger(__name__)

QDRANT_URL = "http://localhost:6333"

# Collection names — constants imported by other services
KB_ARTICLES_COLLECTION = "kb_articles"
TICKET_MESSAGES_COLLECTION = "ticket_messages_index"

# Dense vector config: matches Google text-embedding-004 output (768 dims, cosine)
DENSE_VECTOR_SIZE = 768
DENSE_VECTOR_NAME = "dense"

# Sparse vector config: BM25-style keyword matching for hybrid search
SPARSE_VECTOR_NAME = "sparse"

# Singleton client — imported directly by other services
qdrant = QdrantClient(url=QDRANT_URL)


def _create_hybrid_collection(collection_name: str, recreate: bool = False) -> None:
    """
    Shared helper: creates a Qdrant collection with the standard hybrid search schema:
      - dense named vector: 768-dim cosine (text-embedding-004)
      - sparse named vector: BM25-style keyword matching

    Args:
        collection_name: Target Qdrant collection name.
        recreate: Drop and rebuild if the collection already exists.
    """
    existing = [c.name for c in qdrant.get_collections().collections]

    if collection_name in existing:
        if recreate:
            logger.warning(f"Recreating existing collection '{collection_name}'.")
            qdrant.delete_collection(collection_name)
        else:
            logger.info(f"Collection '{collection_name}' already exists. Skipping creation.")
            return

    qdrant.create_collection(
        collection_name=collection_name,
        vectors_config={
            DENSE_VECTOR_NAME: VectorParams(
                size=DENSE_VECTOR_SIZE,
                distance=Distance.COSINE,
            ),
        },
        sparse_vectors_config={
            SPARSE_VECTOR_NAME: SparseVectorParams(
                index=SparseIndexParams(
                    on_disk=False,  # Keep in memory for fast BM25-style lookups
                ),
            ),
        },
    )

    logger.info(
        f"Created Qdrant collection '{collection_name}' with "
        f"dense ({DENSE_VECTOR_SIZE}d cosine) + sparse (BM25) hybrid config."
    )


def create_kb_collection(recreate: bool = False) -> None:
    """Creates (or recreates) the kb_articles collection for knowledge-base RAG retrieval."""
    _create_hybrid_collection(KB_ARTICLES_COLLECTION, recreate=recreate)


def create_ticket_messages_collection(recreate: bool = False) -> None:
    """
    Creates (or recreates) the ticket_messages_index collection.
    Used exclusively for similarity search among past ticket messages —
    never mixed with kb_articles retrieval in the RAG pipeline.
    """
    _create_hybrid_collection(TICKET_MESSAGES_COLLECTION, recreate=recreate)


def ensure_collections_exist() -> None:
    """Convenience: idempotently ensures both collections exist on startup."""
    create_kb_collection(recreate=False)
    create_ticket_messages_collection(recreate=False)
