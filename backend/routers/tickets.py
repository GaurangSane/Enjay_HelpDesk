import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

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

