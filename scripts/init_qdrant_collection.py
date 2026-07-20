from backend.db.qdrant_client import qdrant
from qdrant_client.models import VectorParams, Distance, SparseVectorParams

client = qdrant

client.create_collection(
    collection_name="kb_articles",
    vectors_config={"dense": VectorParams(size=768, distance=Distance.COSINE)},
    sparse_vectors_config={"sparse": SparseVectorParams()},
)

client.create_collection(
    collection_name="ticket_messages_index",
    vectors_config={"dense": VectorParams(size=768, distance=Distance.COSINE)},
    sparse_vectors_config={"sparse": SparseVectorParams()},
)

print("Collections created successfully.")