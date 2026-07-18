import os
import backend.config  # noqa: F401 — loads .env before Celery reads env vars
from celery import Celery

# Railway injects REDIS_URL automatically when you add the Redis addon.
# Locally, fall back to the Docker Redis on port 6380.
_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6380/0")

celery_app = Celery(
    "enjay_helpdesk",
    broker=_REDIS_URL,
    backend=_REDIS_URL,
    include=["backend.services.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)
