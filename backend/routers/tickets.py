import os
import logging
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, field_validator
from groq import Groq

from backend.services.reply_service import post_reply

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tickets",
    tags=["tickets"]
)

from backend.db.supabase_client import supabase


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


class PolishRequest(BaseModel):
    draft_text: str

    @field_validator("draft_text")
    @classmethod
    def validate_draft(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("draft_text must not be empty")
        return v.strip()


class PolishResponse(BaseModel):
    polished_text: str


# ── Dependencies ──────────────────────────────────────────────────────────────

async def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing or invalid format."
        )
    
    token = authorization.split(" ")[1]
    
    try:
        auth_response = supabase.auth.get_user(token)
        if not auth_response or not auth_response.user:
            raise HTTPException(status_code=401, detail="Invalid session token.")
        user = auth_response.user
    except Exception as e:
        logger.error(f"Supabase auth validation failed: {e}")
        raise HTTPException(status_code=401, detail="Unauthorized session.")

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
        return {"id": user.id, "email": user.email, "role": user_role}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking user role: {e}")
        raise HTTPException(status_code=500, detail="Internal server error checking user role.")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def get_tickets(status: str | None = None, user: dict = Depends(get_current_user)):
    """Returns tickets, optionally filtered by status. Agents see only their assigned tickets, Admins see all."""
    try:
        query = supabase.table("tickets").select("*")
        if status:
            query = query.eq("status", status)
            
        if user["role"] == "agent":
            query = query.eq("assigned_to", user["id"])
            
        response = query.execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{ticket_id}/reply", response_model=ReplyResponse)
async def reply_to_ticket(ticket_id: str, body: ReplyRequest):
    """
    Posts a reply to a ticket from an agent or AI, updates ticket status,
    and dispatches the reply to the customer via Resend.

    Delegates core logic to services/reply_service.py so the same code
    path is used by both the HTTP endpoint and the internal HITL pipeline.
    """
    try:
        result = post_reply(
            ticket_id=ticket_id,
            content=body.content,
            sender=body.sender,
        )
        return ReplyResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticket_id}/hitl-attempts")
async def get_hitl_attempts(ticket_id: str):
    """
    Returns the latest hitl_attempts row for a given ticket, or null if none exist.

    Used by the agent HITL dashboard to display AI pipeline diagnostics:
    - reason: why the pipeline routed to HITL
    - attempted_answer: the LLM draft (if Stage 2 was reached)
    - confidence_score: the LLM's self-reported confidence
    - retrieved_chunks: full Top-5 hybrid search results with scores
    - cited_chunk_ids: IDs the LLM claimed to cite
    - hallucinated_ids: IDs that didn't exist in the retrieved set
    """
    try:
        response = (
            supabase.table("hitl_attempts")
            .select(
                "id, ticket_id, reason, attempted_answer, confidence_score, "
                "retrieved_chunks, cited_chunk_ids, hallucinated_ids, created_at"
            )
            .eq("ticket_id", ticket_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not response.data:
            return {"hitl_attempt": None}

        return {"hitl_attempt": response.data[0]}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/polish", response_model=PolishResponse)
async def polish_draft(body: PolishRequest):
    """
    Polishes an agent's manual reply draft for grammar, tone, and email formatting.
    Does not invent new technical information.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.error("GROQ_API_KEY is not set — cannot polish draft.")
        raise HTTPException(status_code=500, detail="LLM configuration missing.")

    system_prompt = (
        "You are an expert technical editor. Your job is to polish a draft support email written by an agent.\n\n"
        "RULES:\n"
        "1. Fix all grammar, spelling, and punctuation mistakes.\n"
        "2. Improve clarity and ensure a professional, helpful tone.\n"
        "3. Format it as a proper support email:\n"
        "   - Add a warm greeting (e.g., 'Hi there,') if one is missing.\n"
        "   - Use clear paragraph breaks.\n"
        "   - If steps are involved, format them as a numbered or bulleted list.\n"
        "   - Add a professional sign-off (e.g., 'Best regards,\\nEnjay Helpdesk Support Team') if missing.\n"
        "4. CRITICAL: Do NOT add any new technical claims, facts, steps, or information that wasn't in the original draft. This is a tone and formatting pass only.\n"
        "5. Return ONLY the polished text. Do not include preamble, explanations, or quotes."
    )

    try:
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Draft to polish:\n\n{body.draft_text}"},
            ],
            temperature=0.3,
            max_tokens=1024,
        )

        polished_text = response.choices[0].message.content.strip()
        return PolishResponse(polished_text=polished_text)

    except Exception as e:
        logger.error(f"Failed to polish draft: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to polish draft.")

