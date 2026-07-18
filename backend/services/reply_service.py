"""
services/reply_service.py
--------------------------
Reusable core reply logic, separated from the FastAPI router so it can be
called internally by Celery tasks and the HITL gate without going through HTTP.

The router (routers/tickets.py) imports and delegates to these functions.
The HITL gate imports post_reply() to send AI-generated answers.
"""

import os
import logging
from datetime import datetime, timezone

import resend

from backend.db.supabase_client import supabase

logger = logging.getLogger(__name__)


def send_reply_email(to: str, subject: str, content: str) -> tuple[bool, str | None]:
    """
    Sends a reply email via Resend SDK.

    Returns:
        (True, None)          — dispatched successfully.
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
            This message was sent via Enjay Helpdesk. Please reply to continue the conversation.
        </p>
    </div>
    """

    try:
        response = resend.Emails.send({
            "from": os.getenv("RESEND_FROM_EMAIL", os.getenv("SUPPORT_EMAIL_ADDRESS", "support@yourdomain.com")),
            "reply_to": os.getenv("SUPPORT_EMAIL_ADDRESS", "support@yourdomain.com"),
            "to": [to],
            "subject": subject,
            "html": html_body,
            "text": content,
        })
        logger.info(f"Resend dispatched reply to {to!r} | Resend ID: {response.get('id')}")
        return True, None

    except Exception as e:
        logger.error(f"Resend failed to send reply to {to!r}: {e}", exc_info=True)
        return False, str(e)


def post_reply(ticket_id: str, content: str, sender: str) -> dict:
    """
    Core reply logic: inserts a ticket_messages row, optionally updates the
    parent ticket status, and dispatches the reply email via Resend.

    Status transition rules (owned here):
        sender='agent'  →  set status='pending'  (awaiting customer reply)
        sender='ai'     →  do NOT touch status; handle_ai_response() will set
                           'ai_resolved' after this call returns successfully,
                           preventing a double-write race.

    Args:
        ticket_id: UUID of the parent ticket.
        content:   Reply body text.
        sender:    'agent' or 'ai'.

    Returns:
        {
            'message_id': str,
            'success': bool,
            'email_sent': bool,
            'email_error': str | None,
        }

    Raises:
        ValueError: if ticket not found.
        RuntimeError: if the DB insert fails.
    """
    if sender not in ("agent", "ai"):
        raise ValueError(f"sender must be 'agent' or 'ai', got: {sender!r}")

    # 1. Fetch ticket metadata
    ticket_resp = (
        supabase.table("tickets")
        .select("id, subject, customer_email")
        .eq("id", ticket_id)
        .single()
        .execute()
    )
    if not ticket_resp.data:
        raise ValueError(f"Ticket {ticket_id} not found.")

    ticket = ticket_resp.data
    customer_email: str = ticket["customer_email"]
    original_subject: str = ticket["subject"]

    # 2. Insert the new ticket_messages row
    insert_resp = (
        supabase.table("ticket_messages")
        .insert({
            "ticket_id": ticket_id,
            "sender": sender,
            "content": content,
        })
        .execute()
    )
    if not insert_resp.data:
        raise RuntimeError(f"Failed to insert ticket_message for ticket {ticket_id}.")

    new_message_id: str = insert_resp.data[0]["id"]

    # 3. Update parent ticket status (agent replies only).
    #    For AI replies, handle_ai_response() sets 'ai_resolved' after this
    #    function returns — letting it own the full AI status transition.
    if sender == "agent":
        supabase.table("tickets").update({
            "status": "pending",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ticket_id).execute()
        logger.info(
            f"Reply inserted | ticket={ticket_id} | message={new_message_id} | "
            f"sender={sender} | status→pending"
        )
    else:
        # sender == 'ai': bump updated_at only; leave status untouched here.
        supabase.table("tickets").update({
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ticket_id).execute()
        logger.info(
            f"Reply inserted | ticket={ticket_id} | message={new_message_id} | "
            f"sender={sender} | status unchanged (handle_ai_response will set ai_resolved)"
        )

    # 4. Send reply email (non-fatal — failure keeps the DB row)
    reply_subject = f"Re: {original_subject}"
    email_sent, email_error = send_reply_email(
        to=customer_email,
        subject=reply_subject,
        content=content,
    )

    if not email_sent:
        logger.warning(
            f"Ticket {ticket_id}: DB message saved (id={new_message_id}) "
            f"but Resend dispatch failed: {email_error}"
        )

    return {
        "message_id": new_message_id,
        "success": True,
        "email_sent": email_sent,
        "email_error": email_error,
    }
