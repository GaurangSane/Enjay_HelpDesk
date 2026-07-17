import os
import logging

from fastapi import APIRouter, HTTPException, Depends

from backend.db.supabase_client import supabase
from backend.routers.analytics import get_current_admin

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin",
    tags=["admin"]
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_user_email(user_id: str) -> str | None:
    """Look up a user's email via the Supabase Admin Auth API. Returns None on any failure."""
    try:
        response = supabase.auth.admin.get_user_by_id(user_id)
        return response.user.email if response and response.user else None
    except Exception as e:
        logger.warning(f"Could not look up email for user_id={user_id}: {e}")
        return None


def _send_approval_email(to_email: str) -> bool:
    """
    Sends the account-approval notification email via Resend.
    Returns True on success, False on failure. Never raises.
    """
    import resend

    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        logger.error("RESEND_API_KEY not set — cannot send approval email.")
        return False

    resend.api_key = api_key
    support_email = os.getenv("RESEND_FROM_EMAIL", os.getenv("SUPPORT_EMAIL_ADDRESS", "support@yourdomain.com"))

    html_body = f"""
    <div style="font-family: sans-serif; font-size: 14px; color: #1f2937; max-width: 640px;">
        <h2 style="color: #10b981;">Your account has been approved ✓</h2>
        <p>
            Your Enjay Helpdesk account (<strong>{to_email}</strong>) has been reviewed
            and approved by an administrator.
        </p>
        <p>You can now sign in and access the helpdesk dashboard:</p>
        <p>
            <a href="http://localhost:5173/login"
               style="display: inline-block; padding: 10px 20px; background-color: #3b82f6;
                      color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Sign In to Enjay Helpdesk
            </a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">
            If you did not request an account, please ignore this email.
        </p>
    </div>
    """

    text_body = (
        f"Your Enjay Helpdesk account ({to_email}) has been approved by an administrator.\n\n"
        f"You can now sign in at: http://localhost:5173/login"
    )

    try:
        resend.Emails.send({
            "from": support_email,
            "to": [to_email],
            "subject": "Your Enjay Helpdesk account has been approved",
            "html": html_body,
            "text": text_body,
            "headers": {
                "Auto-Submitted": "auto-generated",
                "X-Auto-Response-Suppress": "All",
            },
        })
        logger.info(f"Approval email sent to {to_email!r}")
        return True
    except Exception as e:
        logger.error(f"Failed to send approval email to {to_email!r}: {e}", exc_info=True)
        return False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/approvals")
async def list_pending_approvals(admin: dict = Depends(get_current_admin)):
    """
    Returns all users with role='pending_approval', enriched with their email.
    Requires admin JWT in Authorization: Bearer <token> header.
    """
    try:
        rows_resp = (
            supabase.table("user_roles")
            .select("user_id, role, created_at")
            .eq("role", "pending_approval")
            .order("created_at", desc=False)
            .execute()
        )
        rows = rows_resp.data or []

        pending_users = []
        for row in rows:
            # Individual email lookups are wrapped so one bad user_id never breaks the list
            email = _get_user_email(row["user_id"])
            pending_users.append({
                "user_id": row["user_id"],
                "email": email,
                "created_at": row["created_at"],
            })

        logger.info(f"list_pending_approvals: {len(pending_users)} pending user(s)")
        return {"pending_users": pending_users}

    except Exception as e:
        logger.error(f"Error fetching pending approvals: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error fetching pending approvals.")


@router.post("/approvals/{user_id}/approve")
async def approve_user(user_id: str, admin: dict = Depends(get_current_admin)):
    """
    Approves a pending user:
      1. Verifies the user exists in user_roles with role='pending_approval'.
      2. Promotes their role to 'agent'.
      3. Sends a Resend approval email (non-fatal — approval succeeds even if email fails).
    Requires admin JWT in Authorization: Bearer <token> header.
    """
    # 1. Verify the user exists and is still pending
    try:
        existing_resp = (
            supabase.table("user_roles")
            .select("user_id, role")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        logger.error(f"approve_user: DB lookup failed for user_id={user_id}: {e}")
        raise HTTPException(status_code=500, detail="Database error looking up user.")

    if not existing_resp.data:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found in user_roles.")

    current_role = existing_resp.data[0].get("role")
    if current_role != "pending_approval":
        raise HTTPException(
            status_code=409,
            detail=f"User '{user_id}' is not pending approval (current role: '{current_role}')."
        )

    # 2. Fetch email before updating (needed for notification)
    user_email = _get_user_email(user_id)

    # 3. Promote to 'agent'
    try:
        supabase.table("user_roles").update(
            {"role": "agent"}
        ).eq("user_id", user_id).execute()
        logger.info(
            f"approve_user: user_id={user_id!r} promoted to 'agent' "
            f"by admin={admin.get('email')!r}"
        )
    except Exception as e:
        logger.error(f"approve_user: failed to update role for user_id={user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update user role in database.")

    # 4. Send approval email (non-fatal)
    email_sent = False
    if user_email:
        email_sent = _send_approval_email(user_email)
    else:
        logger.warning(
            f"approve_user: skipping email — could not resolve address for user_id={user_id!r}"
        )

    return {
        "approved": True,
        "user_id": user_id,
        "email": user_email,
        "email_sent": email_sent,
    }
