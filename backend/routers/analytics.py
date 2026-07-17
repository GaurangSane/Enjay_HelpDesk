import os
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Depends
from typing import Any

from backend.db.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"]
)

# ── Authorization Dependency ──────────────────────────────────────────────────

async def get_current_admin(authorization: str = Header(None)) -> dict:
    """
    FastAPI dependency to authenticate the user using their Supabase JWT
    and authorize them by checking if their role is 'admin' in user_roles.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing or invalid format (Bearer token required)."
        )
    
    token = authorization.split(" ")[1]
    
    try:
        # Retrieve the user using the client SDK auth (verifies token automatically)
        auth_response = supabase.auth.get_user(token)
        if not auth_response or not auth_response.user:
            raise HTTPException(status_code=401, detail="Invalid session token.")
        user = auth_response.user
    except Exception as e:
        logger.error(f"Supabase auth validation failed: {e}")
        raise HTTPException(status_code=401, detail="Unauthorized session.")

    # Query the user_roles table for this user
    try:
        role_resp = (
            supabase.table("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .execute()
        )
        if not role_resp.data:
            raise HTTPException(status_code=403, detail="Forbidden: User role not assigned.")
        
        user_role = role_resp.data[0].get("role")
        if user_role != "admin":
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: Admin access required (your role: {user_role})."
            )
            
        return {"id": user.id, "email": user.email, "role": user_role}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking user role: {e}")
        raise HTTPException(status_code=500, detail="Internal server error checking user role.")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/deflection-rate")
async def get_deflection_rate(admin: dict = Depends(get_current_admin)):
    """
    Calculates the AI deflection rate of tickets.
    Requires Authorization: Bearer <JWT> header for a user with role='admin'.
    
    Returns:
        total_tickets: Count of all tickets.
        ai_resolved: Count of tickets resolved by AI (status='ai_resolved').
        hitl_ever: Count of tickets ever routed to human review (either currently 'hitl' 
                   or having at least one attempt entry in 'hitl_attempts').
        deflection_rate: Percentage of total tickets resolved by AI.
    """
    try:
        # 1. Total tickets count
        total_resp = supabase.table("tickets").select("id", count="exact").execute()
        total_count = total_resp.count if total_resp.count is not None else len(total_resp.data or [])
        
        # 2. Count where status = 'ai_resolved'
        ai_resp = supabase.table("tickets").select("id", count="exact").eq("status", "ai_resolved").execute()
        ai_count = ai_resp.count if ai_resp.count is not None else len(ai_resp.data or [])
        
        # 3. Count where status was ever 'hitl'
        # Unique ticket_ids in hitl_attempts
        hitl_attempts_resp = supabase.table("hitl_attempts").select("ticket_id").execute()
        hitl_attempt_ticket_ids = {row["ticket_id"] for row in hitl_attempts_resp.data} if hitl_attempts_resp.data else set()

        # Tickets currently in 'hitl' status
        current_hitl_resp = supabase.table("tickets").select("id").eq("status", "hitl").execute()
        current_hitl_ids = {row["id"] for row in current_hitl_resp.data} if current_hitl_resp.data else set()

        # Combined unique count of tickets ever routed to human review
        hitl_ever_ids = hitl_attempt_ticket_ids.union(current_hitl_ids)
        hitl_ever_count = len(hitl_ever_ids)
        
        # 4. Count where status = 'resolved' (human-resolved)
        resolved_resp = supabase.table("tickets").select("id", count="exact").eq("status", "resolved").execute()
        resolved_count = resolved_resp.count if resolved_resp.count is not None else len(resolved_resp.data or [])

        # 5. Compute deflection rate
        deflection_rate = (ai_count / total_count * 100) if total_count > 0 else 0.0
        
        return {
            "total_tickets": total_count,
            "ai_resolved": ai_count,
            "hitl_ever": hitl_ever_count,
            "human_resolved": resolved_count,
            "deflection_rate": round(deflection_rate, 2)
        }
    except Exception as e:
        logger.error(f"Error calculating deflection rate: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error retrieving deflection rate analytics.")
