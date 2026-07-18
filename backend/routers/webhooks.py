import os
import re
import logging
import httpx
from email.utils import parseaddr
from fastapi import APIRouter, Request, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
from bs4 import BeautifulSoup
from groq import Groq
from backend.db.supabase_client import supabase
from backend.services.tasks import sync_ticket_message_task, trigger_ai_response_task

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/webhooks",
    tags=["webhooks"]
)


def extract_email_address(raw_from: str) -> str:
    """
    Extracts a bare email address from a raw From header that may include
    a display name in 'Display Name <email@domain.com>' format.

    Uses Python's email.utils.parseaddr which handles all RFC 5322 variants:
        'John Smith <john@example.com>'  →  'john@example.com'
        'john@example.com'               →  'john@example.com'
        'John Smith john@example.com'   →  'john@example.com'  (fallback regex)

    Returns the extracted address lowercased, or the original string if parsing fails.
    """
    # parseaddr returns ('Display Name', 'email@domain.com') or ('', 'raw_string')
    name, addr = parseaddr(raw_from)
    if addr and "@" in addr:
        return addr.strip().lower()

    # Fallback: regex grab for <email> or bare email
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", raw_from)
    if match:
        return match.group(0).lower()

    logger.warning(f"Could not extract email address from raw from header: {raw_from!r}")
    return raw_from.strip().lower()


def normalize_subject(subject: str) -> str:
    """
    Strips ALL leading Re:/RE:/Fwd: prefixes (possibly repeated, e.g. 'Re: Re: Re:')
    using a case-insensitive regex loop, then trims whitespace.

    Also strips the exact auto-acknowledgment suffix appended by this system:
        " — We've received your request"
    This prevents our own ack emails from creating new tickets when they
    bounce back or are replied to.

    Examples:
        'Re: Re: Support request'                           →  'Support request'
        'RE: Fwd: Re: Order issue'                          →  'Order issue'
        'Re[2]: SNG-4021 error'                             →  'SNG-4021 error'
        'Re: SNG-4021 — We\'ve received your request'       →  'SNG-4021'
    """
    # Repeatedly strip leading prefixes until none remain
    prefix_pattern = re.compile(
        r"^(re(\[\d+\])?:|fwd:|fw:)\s*",
        flags=re.IGNORECASE
    )
    prev = None
    result = subject.strip()
    while result != prev:
        prev = result
        result = prefix_pattern.sub("", result).strip()

    # Strip our own auto-acknowledgment suffix (exact, case-sensitive match)
    ACK_SUFFIX = " \u2014 We\u2019ve received your request"  # em-dash + curly apostrophe
    if result.endswith(ACK_SUFFIX):
        result = result[: -len(ACK_SUFFIX)].strip()

    return result


def extract_plain_text(html: str) -> str:
    """Strip HTML tags and return clean plain text using BeautifulSoup."""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n", strip=True)


async def classify_customer_message(message: str) -> str:
    """
    Uses Groq (cheap, fast LLM call) to classify a customer's reply into one
    of two categories:

        'closing_remark'  — a thank-you, acknowledgment, or conversation-ending
                            message that contains no new question or issue.
                            Examples: "ok thanks", "got it, works now", "appreciated".

        'new_query'       — contains an actual question, problem, complaint, or
                            follow-up that requires a substantive response.

    Returns the single classification word (lower-cased, stripped).
    Defaults to 'new_query' on any error so the pipeline always runs safely.

    This call is intentionally cheap:
        - Short, stateless system prompt
        - max_tokens=5 (one word is all we need)
        - llama-3.1-8b-instant for minimal latency
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("[CLASSIFY] GROQ_API_KEY not set — defaulting to 'new_query'.")
        return "new_query"

    system_prompt = (
        "You are a message classifier for a customer support system. "
        "Classify the customer's message as exactly one of these two labels:\n\n"
        "  closing_remark — a thank-you, acknowledgment, confirmation that the issue "
        "is resolved, or any conversation-ending pleasantry with no new question or problem.\n"
        "  new_query — contains a new question, problem, complaint, request, or follow-up "
        "that requires a substantive response from support.\n\n"
        "Reply with ONLY the single label word. No punctuation, no explanation."
    )

    try:
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": message[:500]},  # cap at 500 chars — cheap call
            ],
            temperature=0.0,
            max_tokens=5,
        )
        raw = response.choices[0].message.content.strip().lower()
        # Accept the label even if the model adds minor punctuation or surrounding text
        if "closing_remark" in raw:
            return "closing_remark"
        if "new_query" in raw:
            return "new_query"
        # Unexpected output — log and default to safe path
        logger.warning(f"[CLASSIFY] Unexpected classification output: {raw!r} — defaulting to 'new_query'.")
        return "new_query"
    except Exception as e:
        logger.error(f"[CLASSIFY] Groq classification call failed: {e} — defaulting to 'new_query'.", exc_info=True)
        return "new_query"


async def fetch_email_body(email_id: str) -> tuple[str, dict]:
    """
    Fetch the full email body AND headers from Resend's Retrieve Received Email API.

    Returns:
        (body_text, headers_dict)
        - body_text: plain text content (gracefully degrades to placeholder on failure)
        - headers_dict: dict of email headers keyed by lowercase header name
                        e.g. {'in-reply-to': '<abc@mail.example.com>', 'references': '...'}
                        Empty dict on failure.

    Never raises — always returns so the webhook handler doesn't crash.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        logger.error("RESEND_API_KEY is not configured — cannot fetch email body.")
        return "[Email body could not be retrieved: RESEND_API_KEY not set]", {}

    url = f"https://api.resend.com/emails/receiving/{email_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)

        if response.status_code != 200:
            logger.warning(
                f"Resend API returned {response.status_code} for email_id={email_id}: {response.text}"
            )
            return "[Email body could not be retrieved]", {}

        payload = response.json()

        # Extract headers as a normalized lowercase dict for threading lookups
        raw_headers = payload.get("headers", {})
        if isinstance(raw_headers, list):
            # Some providers return [{"name": "...", "value": "..."}] format
            parsed_headers = {
                h.get("name", "").lower(): h.get("value", "")
                for h in raw_headers
                if h.get("name")
            }
        elif isinstance(raw_headers, dict):
            parsed_headers = {k.lower(): v for k, v in raw_headers.items()}
        else:
            parsed_headers = {}

        # Prefer plain text; fall back to stripping HTML
        if payload.get("text"):
            return payload["text"].strip(), parsed_headers
        elif payload.get("html"):
            logger.info(f"No text field for email_id={email_id}, falling back to HTML stripping.")
            return extract_plain_text(payload["html"]), parsed_headers
        else:
            logger.warning(f"Both text and html fields are empty for email_id={email_id}.")
            return "[Email body was empty]", parsed_headers

    except httpx.TimeoutException:
        logger.error(f"Timeout fetching email body for email_id={email_id}")
        return "[Email body could not be retrieved: request timed out]", {}
    except Exception as e:
        logger.error(f"Unexpected error fetching email body for email_id={email_id}: {e}")
        return "[Email body could not be retrieved]", {}


@router.post("/resend")
async def resend_webhook(request: Request):
    # ── Step 1: Verify Svix signature ─────────────────────────────────────────
    secret = os.getenv("RESEND_WEBHOOK_SECRET")
    if not secret:
        logger.error("RESEND_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=500, detail="Webhook secret not configured.")

    payload = await request.body()
    headers = dict(request.headers)

    try:
        wh = Webhook(secret)
        msg = wh.verify(payload, headers)
    except WebhookVerificationError:
        logger.warning("Invalid Resend webhook signature — request rejected.")
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # ── Step 2: Extract raw metadata ──────────────────────────────────────────
    data = msg.get("data", {})
    email_id: str = data.get("email_id", "")
    raw_from: str = data.get("from", "")
    raw_subject: str = data.get("subject", "(No Subject)")
    # message_id is Resend's own ID for the inbound email (used for threading)
    resend_message_id: str = data.get("message_id", "")

    # ── Step 3: Diagnostic logging (BEFORE any matching logic) ────────────────
    logger.info(
        f"[INBOUND] email_id={email_id!r} | raw_from={raw_from!r} | "
        f"raw_subject={raw_subject!r} | message_id={resend_message_id!r}"
    )

    if not raw_from:
        raise HTTPException(status_code=400, detail="Missing 'from' field in webhook payload.")

    if not email_id:
        logger.warning("No email_id in webhook payload — cannot fetch full email body.")

    # ── Step 4: Parse email address from raw From header ──────────────────────
    # Handles "John Smith <john@example.com>" → "john@example.com"
    sender_email = extract_email_address(raw_from)
    logger.info(
        f"[INBOUND] Parsed sender_email={sender_email!r} from raw_from={raw_from!r}"
    )

    # ── Step 5: Fetch full body + headers from Resend API ────────────────────
    if email_id:
        body, email_headers = await fetch_email_body(email_id)
    else:
        body = "[Email body unavailable: no email_id]"
        email_headers = {}

    in_reply_to: str = email_headers.get("in-reply-to", "").strip()
    references: str = email_headers.get("references", "").strip()
    auto_submitted: str = email_headers.get("auto-submitted", "").strip().lower()
    x_auto_suppress: str = email_headers.get("x-auto-response-suppress", "").strip().lower()
    precedence: str = email_headers.get("precedence", "").strip().lower()

    logger.info(
        f"[INBOUND] in-reply-to={in_reply_to!r} | references={references!r} | "
        f"auto-submitted={auto_submitted!r} | precedence={precedence!r}"
    )

    # ── Bot / auto-responder detection — hard exit before any DB write ─────────
    # RFC 3834: Auto-Submitted must be 'no' for genuine human messages.
    # Any other value ('auto-replied', 'auto-generated', 'auto-notified') means
    # this is a bot, OOO reply, delivery status notification, or another
    # auto-responder. Processing it would risk creating a ticket-spam loop.
    is_automated_sender = (
        (auto_submitted and auto_submitted != "no")
        or (precedence in ("bulk", "junk", "list"))
        or bool(x_auto_suppress)  # Any value signals "don't auto-respond to me"
    )

    if is_automated_sender:
        logger.warning(
            f"[INBOUND] Dropping automated/bot email from {sender_email!r}: "
            f"auto-submitted={auto_submitted!r}, precedence={precedence!r}, "
            f"x-auto-response-suppress={x_auto_suppress!r}. No ticket created."
        )
        # Return 200 so Resend/Svix doesn't retry — we intentionally discarded this.
        return {"skipped": True, "reason": "automated_sender"}

    normalized_subject = normalize_subject(raw_subject)
    logger.info(
        f"[INBOUND] raw_subject={raw_subject!r} → normalized={normalized_subject!r}"
    )

    # ── Step 6: Thread matching (header-first, subject-fallback) ─────────────
    #
    # Priority:
    #   A. In-Reply-To / References header match against stored message_id
    #      (most reliable — immune to subject rewrites by email clients)
    #   B. Normalized subject + customer_email match
    #      (fallback for clients that strip threading headers)
    #
    # NOTE: Resend's inbound webhook payload includes `message_id` for the
    # incoming email. To support A, we'd need to store the outbound Message-ID
    # from each reply we send, then match In-Reply-To against it. This is
    # currently not implemented (tickets table has no outbound_message_id column),
    # so we log the headers for now and rely on subject-based matching (B).
    # When you add an `outbound_message_id` column to tickets, replace the
    # subject-matching block with a query on that column.

    matched_ticket_id = None
    match_method = None

    # ── Method A: Header-based matching (future — requires outbound_message_id) ──
    # Uncomment and adapt once you store outbound Message-IDs:
    #
    # if in_reply_to or references:
    #     ref_ids = set(filter(None, [in_reply_to] + references.split()))
    #     header_match = (
    #         supabase.table("tickets")
    #         .select("id")
    #         .in_("outbound_message_id", list(ref_ids))
    #         .in_("status", ["open", "pending", "hitl"])
    #         .limit(1)
    #         .execute()
    #     )
    #     if header_match.data:
    #         matched_ticket_id = header_match.data[0]["id"]
    #         match_method = "header"

    # ── Method B: Subject + customer_email matching ───────────────────────────
    # Broaden the status filter to catch 'ai_resolved' and 'resolved' tickets
    # too — a customer replying to any of these should reopen the thread.
    if not matched_ticket_id:
        existing_response = (
            supabase.table("tickets")
            .select("id, subject, status")
            .eq("customer_email", sender_email)
            .in_("status", ["open", "pending", "hitl", "ai_resolved", "resolved"])
            .execute()
        )

        logger.info(
            f"[INBOUND] Subject-match query returned {len(existing_response.data or [])} "
            f"active ticket(s) for {sender_email!r}"
        )

        if existing_response.data:
            for ticket in existing_response.data:
                ticket_norm = normalize_subject(ticket["subject"])
                logger.info(
                    f"[INBOUND] Comparing: incoming={normalized_subject!r} "
                    f"vs ticket[{ticket['id']}]={ticket_norm!r} (status={ticket['status']!r})"
                )
                if ticket_norm == normalized_subject:
                    matched_ticket_id = ticket["id"]
                    match_method = "subject"
                    break

    logger.info(
        f"[INBOUND] Match result: ticket_id={matched_ticket_id!r} method={match_method!r}"
    )

    # ── Step 7: Route to existing thread or create new ticket ─────────────────
    if matched_ticket_id:
        # Thread exists — append new customer message, then:
        #
        # ① Classify the message (cheap Groq call, ~100 ms) to decide whether
        #   it is a closing remark ("thanks, it worked") or a new_query.
        #
        # ② closing_remark path:
        #   - Persist the message for record-keeping.
        #   - Set ticket status to 'resolved' (customer confirmed issue is closed).
        #   - Skip AI pipeline — no response needed.
        #
        # ③ new_query path:
        #   - Status logic (same as before):
        #       pending / ai_resolved / resolved → reset to 'open'
        #       open / hitl                      → leave as-is
        #   - Queue AI pipeline as normal.
        #
        # We re-fetch the current status because it may have changed between the
        # match query above and the update below (narrow but real race window).
        current_status_resp = (
            supabase.table("tickets")
            .select("status")
            .eq("id", matched_ticket_id)
            .single()
            .execute()
        )
        current_status = (current_status_resp.data or {}).get("status", "open")

        # ── ① Fast classification ─────────────────────────────────────────────
        classification = await classify_customer_message(body)
        logger.info(
            f"[INBOUND] Ticket {matched_ticket_id}: message classified as {classification!r} "
            f"(current_status={current_status!r})"
        )

        # Always persist the customer message (even for closing remarks — good audit trail)
        insert_response = supabase.table("ticket_messages").insert({
            "ticket_id": matched_ticket_id,
            "sender": "customer",
            "content": body,
        }).execute()

        ticket_id = matched_ticket_id

        if classification == "closing_remark":
            # ── ② Closing remark: resolve ticket, skip AI ─────────────────────
            supabase.table("tickets").update(
                {"status": "resolved"}
            ).eq("id", matched_ticket_id).execute()
            logger.info(
                f"[INBOUND] Ticket {matched_ticket_id}: closing remark detected — "
                f"status set to 'resolved', AI pipeline skipped."
            )
            # Still sync the message into the vector index for future KB searches
            if insert_response.data:
                new_message_id = insert_response.data[0]["id"]
                sync_ticket_message_task.delay(new_message_id)

        else:
            # ── ③ new_query: reopen if needed and run AI pipeline ─────────────
            REOPEN_STATUSES = {"pending", "ai_resolved", "resolved"}
            if current_status in REOPEN_STATUSES:
                supabase.table("tickets").update({"status": "open"}).eq("id", matched_ticket_id).execute()
                logger.info(
                    f"[INBOUND] Ticket {matched_ticket_id}: status '{current_status}' → 'open' "
                    f"(new customer query received)."
                )
            else:
                logger.info(
                    f"[INBOUND] Ticket {matched_ticket_id}: status '{current_status}' left unchanged "
                    f"(already awaiting action)."
                )

            if insert_response.data:
                new_message_id = insert_response.data[0]["id"]
                sync_ticket_message_task.delay(new_message_id)
                trigger_ai_response_task.delay(ticket_id, new_message_id)

        logger.info(
            f"[INBOUND] Appended to existing ticket {ticket_id} "
            f"(match_method={match_method!r}, classification={classification!r}) for {sender_email!r}"
        )

    else:
        # No match — create a new ticket + first message
        new_ticket_response = (
            supabase.table("tickets")
            .insert({
                "subject": raw_subject,
                "customer_email": sender_email,
                "status": "open",
            })
            .execute()
        )

        if not new_ticket_response.data:
            raise HTTPException(status_code=500, detail="Failed to create ticket in database.")

        ticket_id = new_ticket_response.data[0]["id"]

        first_message_response = supabase.table("ticket_messages").insert({
            "ticket_id": ticket_id,
            "sender": "customer",
            "content": body,
        }).execute()

        if first_message_response.data:
            new_message_id = first_message_response.data[0]["id"]
            sync_ticket_message_task.delay(new_message_id)
            trigger_ai_response_task.delay(ticket_id, new_message_id)

        # ── Auto-acknowledgment (new tickets ONLY, gated on human sender) ─────
        # This block is structurally unreachable from the reply-append path above.
        # The is_automated_sender guard already ran before we reach here,
        # so we know the sender is human. Still make the intent explicit.
        try:
            import resend
            resend.api_key = os.getenv("RESEND_API_KEY")
            if resend.api_key:
                ack_subject = f"Re: {raw_subject} \u2014 We\u2019ve received your request"
                ack_body_text = (
                    f"Thank you for reaching out. Your ticket #{ticket_id} has been received "
                    f"and one of our agents or our AI assistant will respond shortly."
                )
                ack_body_html = f"""
                <div style="font-family: sans-serif; font-size: 14px; color: #1f2937; max-width: 640px;">
                    <p>{ack_body_text}</p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af;">
                        This is an automated acknowledgment. Please do not reply to this email
                        directly unless updating the ticket.
                    </p>
                </div>
                """
                resend.Emails.send({
                    "from": os.getenv("RESEND_FROM_EMAIL", os.getenv("SUPPORT_EMAIL_ADDRESS", "support@yourdomain.com")),
                    "reply_to": os.getenv("SUPPORT_EMAIL_ADDRESS", "support@yourdomain.com"),
                    "to": [sender_email],
                    "subject": ack_subject,
                    "html": ack_body_html,
                    "text": ack_body_text,
                    # RFC 3834 headers — tells receiving mail servers and
                    # auto-responders that this is an automated reply,
                    # preventing them from triggering their own auto-replies.
                    "headers": {
                        "Auto-Submitted": "auto-replied",
                        "X-Auto-Response-Suppress": "All",
                    },
                })
                logger.info(f"[INBOUND] Auto-acknowledgment sent to {sender_email!r} for ticket {ticket_id}")
            else:
                logger.error("RESEND_API_KEY not configured — skipped auto-acknowledgment.")
        except Exception as e:
            logger.error(
                f"[INBOUND] Failed to send auto-acknowledgment for ticket {ticket_id}: {e}",
                exc_info=True,
            )

        logger.info(f"[INBOUND] Created new ticket {ticket_id} for {sender_email!r}")

    return {"ticket_id": ticket_id}
