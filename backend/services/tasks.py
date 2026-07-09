import logging
from celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="services.tasks.sync_ticket_message_task")
def sync_ticket_message_task(ticket_message_id: str):
    """
    Placeholder task: logs the ticket_message_id being processed.
    Real embedding generation and Qdrant sync logic will be added here on Day 3.
    """
    logger.info(f"Processing ticket_message: {ticket_message_id}")
    return {"status": "logged", "ticket_message_id": ticket_message_id}
