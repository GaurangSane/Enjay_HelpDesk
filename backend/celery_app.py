from celery import Celery

celery_app = Celery(
    "enjay_helpdesk",
    broker="redis://localhost:6380/0",
    backend="redis://localhost:6380/0",
    include=["backend.services.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)
