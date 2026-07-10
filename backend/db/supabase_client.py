import os
import backend.config  # noqa: F401 — loads .env before supabase client init
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError(
        "SUPABASE_URL and SUPABASE_KEY must be set in backend/.env. "
        "Copy backend/.env.example to backend/.env and fill in your keys."
    )

# Service role client — bypasses RLS for backend/admin operations
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
