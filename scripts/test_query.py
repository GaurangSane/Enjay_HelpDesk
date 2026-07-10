import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend modules are importable
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

from backend.services.query_generation import generate_standalone_query

def main():
    # Provide an existing Ticket ID from your database here
    if len(sys.argv) < 2:
        print("Please provide a ticket_id. Usage: python scripts/test_query.py <ticket_id>")
        return
        
    ticket_id = sys.argv[1]
    
    print(f"Analyzing ticket: {ticket_id}...")
    rewritten_query = generate_standalone_query(ticket_id)
    
    print("\n========================================")
    print("🧠 FINAL SEARCH QUERY GENERATED:")
    print("========================================")
    print(rewritten_query if rewritten_query else "None (Skipped - Agent/AI was the last sender)")
    print("========================================\n")

if __name__ == "__main__":
    main()