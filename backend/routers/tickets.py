import os
import logging
from datetime import datetime, timezone

import resend
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from db.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tickets",
    tags=["tickets"]
)

# ── Request / Response Models ─────────────────────────────────────────────────

class ReplyRequest(BaseModel):
    content: str
    sender: str  # must be 'agent' or 'ai'

    @field_validator("sender")
    @classmethod
    def validate_sender(cls, v: str) -> str:
        if v not in ("agent", "ai"):
            raise ValueError("sender must be 'agent' or 'ai'")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("content must not be empty")
        return v.strip()


class ReplyResponse(BaseModel):
    message_id: str
    success: bool
    email_sent: bool
    email_error: str | None = None


# ── Helper: send reply email via Resend ───────────────────────────────────────

def _send_reply_email(
    to: str,
    subject: str,
    content: str,
) -> tuple[bool, str | None]:
    """
    Sends a plain-text reply email via Resend SDK.

    Returns:
        (True, None)          — email dispatched successfully.
        (False, error_reason) — dispatch failed; DB insert is kept regardless.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        logger.error("RESEND_API_KEY is not configured — cannot send reply email.")
        return False, "RESEND_API_KEY not configured on server"

    resend.api_key = api_key

    html_body = f"""
    <div style="font-family: sans-serif; font-size: 14px; color: #1f2937; max-width: 640px;">
        <p>{content.replace(chr(10), "<br>")}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">
            This message was sent via Enjay Helpdesk. Please reply to this email to continue the conversation.
        </p>
    </div>
    """

    try:
        response = resend.Emails.send({
            "from": os.getenv("RESEND_FROM_EMAIL", "support@yourdomain.com"),
            "to": [to],
            "subject": subject,
            "html": html_body,
            "text": content,  # plain-text fallback for non-HTML clients
        })
        logger.info(f"Resend dispatched reply to {to!r} | Resend ID: {response.get('id')}")
        return True, None

    except Exception as e:
        logger.error(f"Resend failed to send reply to {to!r}: {e}", exc_info=True)
        return False, str(e)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def get_tickets():
    """Returns all tickets (service_role bypasses RLS — admin use only)."""
    try:
        response = supabase.table("tickets").select("*").execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{ticket_id}/reply", response_model=ReplyResponse)
async def reply_to_ticket(ticket_id: str, body: ReplyRequest):
    """
    Posts a reply to a ticket from an agent or AI, updates the ticket status,
    and dispatches the reply to the customer via Resend.

    If the Resend dispatch fails, the DB message is still kept and the response
    will set email_sent=False with the error reason so the agent can manually resend.
    """
    # 1. Fetch the parent ticket (need customer_email and subject)
    ticket_response = (
        supabase.table("tickets")
        .select("id, subject, customer_email, status")
        .eq("id", ticket_id)
        .single()
        .execute()
    )

    if not ticket_response.data:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found.")

    ticket = ticket_response.data
    customer_email: str = ticket["customer_email"]
    original_subject: str = ticket["subject"]

    # 2. Insert the new ticket_messages row
    insert_response = (
        supabase.table("ticket_messages")
        .insert({
            "ticket_id": ticket_id,
            "sender": body.sender,
            "content": body.content,
        })
        .execute()
    )

    if not insert_response.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to insert ticket message into the database."
        )

    new_message = insert_response.data[0]
    new_message_id: str = new_message["id"]

    # 3. Update the parent ticket: status='pending', updated_at=now()
    supabase.table("tickets").update({
        "status": "pending",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", ticket_id).execute()

    logger.info(
        f"Reply inserted for ticket {ticket_id} | message_id={new_message_id} | sender={body.sender}"
    )

    # 4. Dispatch reply email via Resend (non-blocking: failure does NOT roll back the DB insert)
    reply_subject = f"Re: {original_subject}"
    email_sent, email_error = _send_reply_email(
        to=customer_email,
        subject=reply_subject,
        content=body.content,
    )

    if not email_sent:
        logger.warning(
            f"Ticket {ticket_id}: DB message saved (id={new_message_id}) "
            f"but Resend dispatch failed: {email_error}"
        )

    return ReplyResponse(
        message_id=new_message_id,
        success=True,
        email_sent=email_sent,
        email_error=email_error,
    )
