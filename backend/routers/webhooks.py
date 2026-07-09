import os
import re
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
from bs4 import BeautifulSoup
from db.supabase_client import supabase
from services.tasks import sync_ticket_message_task

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/webhooks",
    tags=["webhooks"]
)


def normalize_subject(subject: str) -> str:
    """Strips 'Re:', 'Re[2]:', 'Fwd:', etc. from email subjects for thread matching."""
    return re.sub(r"^(re(\[\d+\])?:\s*|fwd:\s*)+", "", subject, flags=re.IGNORECASE).strip()


def extract_plain_text(html: str) -> str:
    """Strip HTML tags and return clean plain text using BeautifulSoup."""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n", strip=True)


async def fetch_email_body(email_id: str) -> str:
    """
    Fetch the full email body from Resend's Retrieve Received Email API.
    Returns plain text body, or a safe placeholder string if retrieval fails.
    Prefers the 'text' field; falls back to HTML-stripped 'html' field.
    Never raises — always returns a string so the webhook doesn't crash.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        logger.error("RESEND_API_KEY is not configured — cannot fetch email body.")
        return "[Email body could not be retrieved: RESEND_API_KEY not set]"

    url = f"https://api.resend.com/emails/receiving/{email_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)

        if response.status_code != 200:
            logger.warning(
                f"Resend API returned {response.status_code} for email_id={email_id}: {response.text}"
            )
            return "[Email body could not be retrieved]"

        payload = response.json()

        # Prefer plain text; fall back to stripping HTML
        if payload.get("text"):
            return payload["text"].strip()
        elif payload.get("html"):
            logger.info(f"No text field for email_id={email_id}, falling back to HTML stripping.")
            return extract_plain_text(payload["html"])
        else:
            logger.warning(f"Both text and html fields are empty for email_id={email_id}.")
            return "[Email body was empty]"

    except httpx.TimeoutException:
        logger.error(f"Timeout fetching email body for email_id={email_id}")
        return "[Email body could not be retrieved: request timed out]"
    except Exception as e:
        logger.error(f"Unexpected error fetching email body for email_id={email_id}: {e}")
        return "[Email body could not be retrieved]"


@router.post("/resend")
async def resend_webhook(request: Request):
    # 1. Verify Svix signature — reject unsigned or tampered requests immediately
    secret = os.getenv("RESEND_WEBHOOK_SECRET")
    if not secret:
        logger.error("RESEND_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=500, detail="Webhook secret not configured.")

    payload = await request.body()
    headers = dict(request.headers)

    try:
        wh = Webhook(secret)
        msg = wh.verify(payload, headers)
    except WebhookVerificationError:
        logger.warning("Invalid Resend webhook signature — request rejected.")
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # 2. Parse inbound email metadata from the webhook payload
    # Resend inbound webhooks only send metadata (email_id, from, subject) at this stage
    data = msg.get("data", {})
    email_id: str = data.get("email_id", "")
    sender_email: str = data.get("from", "")
    raw_subject: str = data.get("subject", "(No Subject)")

    if not sender_email:
        raise HTTPException(status_code=400, detail="Missing 'from' field in webhook payload.")

    if not email_id:
        logger.warning("No email_id in webhook payload — cannot fetch full email body.")

    # 3. Fetch full email body from Resend API (gracefully degrades on failure)
    body = await fetch_email_body(email_id) if email_id else "[Email body unavailable: no email_id]"

    normalized = normalize_subject(raw_subject)

    # 4. Check for an existing open/pending/hitl ticket from this customer with matching subject
    existing_response = (
        supabase.table("tickets")
        .select("id, subject, status")
        .eq("customer_email", sender_email)
        .in_("status", ["open", "pending", "hitl"])
        .execute()
    )

    matched_ticket_id = None
    if existing_response.data:
        for ticket in existing_response.data:
            if normalize_subject(ticket["subject"]) == normalized:
                matched_ticket_id = ticket["id"]
                break

    if matched_ticket_id:
        # 4a. Thread exists — append new customer message and re-surface the ticket
        insert_response = supabase.table("ticket_messages").insert({
            "ticket_id": matched_ticket_id,
            "sender": "customer",
            "content": body,
        }).execute()

        supabase.table("tickets").update({"status": "open"}).eq("id", matched_ticket_id).execute()

        ticket_id = matched_ticket_id

        # Fire async task to process the new message (embedding + Qdrant sync on Day 3)
        if insert_response.data:
            new_message_id = insert_response.data[0]["id"]
            sync_ticket_message_task.delay(new_message_id)

        logger.info(f"Appended message to existing ticket {ticket_id} for {sender_email}")
    else:
        # 4b. No match — create a new ticket and its first message
        new_ticket_response = (
            supabase.table("tickets")
            .insert({
                "subject": raw_subject,
                "customer_email": sender_email,
                "status": "open",
            })
            .execute()
        )

        if not new_ticket_response.data:
            raise HTTPException(status_code=500, detail="Failed to create ticket in database.")

        ticket_id = new_ticket_response.data[0]["id"]

        first_message_response = supabase.table("ticket_messages").insert({
            "ticket_id": ticket_id,
            "sender": "customer",
            "content": body,
        }).execute()

        # Fire async task to process the first message (embedding + Qdrant sync on Day 3)
        if first_message_response.data:
            new_message_id = first_message_response.data[0]["id"]
            sync_ticket_message_task.delay(new_message_id)

        logger.info(f"Created new ticket {ticket_id} for {sender_email}")


    return {"ticket_id": ticket_id}
