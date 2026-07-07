from fastapi import APIRouter, HTTPException
from db.supabase_client import supabase

router = APIRouter(
    prefix="/tickets",
    tags=["tickets"]
)

@router.get("/")
async def get_tickets():
    try:
        # Query the tickets table using the service role client
        response = supabase.table("tickets").select("*").execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
