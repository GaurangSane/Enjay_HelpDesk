import os
import sys
from pathlib import Path
import json
from dotenv import load_dotenv

# Ensure backend modules are importable
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

from dotenv import load_dotenv


from backend.services.hitl_gate import process_ticket_for_ai_answer

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_hitl.py <ticket_id>")
        return
        
    ticket_id = sys.argv[1]
    print(f"🚪 Running 2-Stage HITL Gate for Ticket: {ticket_id}\n")
    
    result = process_ticket_for_ai_answer(ticket_id)
    
    print("========================================")
    print(f"🚦 FINAL ACTION: {result.get('action', 'UNKNOWN').upper()}")
    print("========================================")
    
    if result.get('action') == 'hitl':
        print(f"🛑 REASON: {result.get('reason')}")
        if 'max_score' in result:
            print(f"📊 Vector Score (Stage 1): {result.get('max_score'):.4f}")
        if 'raw_response' in result:
            print(f"🤖 Raw LLM Output (Stage 2):\n{result.get('raw_response')}")
    
    elif result.get('action') == 'auto_send':
        print(f"✅ Confidence Score: {result.get('confidence_score')}/10")
        print(f"📚 Citations Used: {len(result.get('cited_chunk_ids', []))}")
        print(f"\n📝 Generated Answer:\n{result.get('answer')}")
        
    print("\n[Raw JSON Data Returned to System]")
    # We remove the retrieved_chunks from the printout just so it doesn't flood your terminal
    display_result = {k: v for k, v in result.items() if k != 'retrieved_chunks'}
    print(json.dumps(display_result, indent=2, default=str))

if __name__ == "__main__":
    main()