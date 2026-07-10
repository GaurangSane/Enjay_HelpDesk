import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend modules are importable
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

from backend.services.hitl_gate import handle_ai_response

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_auto_reply.py <ticket_id>")
        return
        
    ticket_id = sys.argv[1]
    print(f"🚀 Running Final AI Orchestrator for Ticket: {ticket_id}...\n")
    
    # This will trigger the whole pipeline: Query -> Retrieve -> LLM -> Validate -> Send/HITL
    handle_ai_response(ticket_id)
    
    print("✅ Execution complete! Please check your terminal logs, Supabase, and your Email inbox.")

if __name__ == "__main__":
    main()