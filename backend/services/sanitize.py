import re
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Injection pattern blocklist (case-insensitive)
# Matches common prompt-hijacking phrases used to override LLM instructions.
# ---------------------------------------------------------------------------
_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?",
    r"disregard\s+(all\s+)?(the\s+)?(above|previous|prior|earlier)",
    r"forget\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?",
    r"override\s+(the\s+)?(system|above|previous|prior)\s+(prompt|instructions?)?",
    r"you\s+are\s+now\s+in\s+(developer|jailbreak|dan|admin)\s+mode",
    r"act\s+as\s+(if\s+)?(you\s+(have|had|are)\s+no\s+restrictions?)",
    r"system\s*prompt",
    r"new\s+instructions?:",
    r"<\s*system\s*>",       # XML/HTML-style system tag injection
    r"\[system\]",            # bracket-style system tag
    r"###\s*(instructions?|system|prompt)",  # markdown header injection
]

_COMPILED_PATTERNS = [
    re.compile(pattern, re.IGNORECASE | re.DOTALL)
    for pattern in _INJECTION_PATTERNS
]

# Delimiter tag used to wrap sanitized user content in the LLM prompt
_OPEN_DELIMITER = "<user_content>"
_CLOSE_DELIMITER = "</user_content>"


def sanitize_for_llm(text: str) -> str:
    """
    Sanitizes user-supplied text before it is inserted into an LLM prompt.

    Steps:
      1. Strips known prompt-injection phrases using regex blocklist.
      2. Collapses any resulting excessive whitespace.
      3. Wraps the cleaned text in <user_content>...</user_content> delimiters
         so the LLM system prompt can clearly distinguish between the
         system instructions and untrusted user-supplied input.

    Args:
        text: Raw user/customer-supplied content (e.g., email body, ticket text).

    Returns:
        Sanitized text, wrapped in delimiters, safe for LLM prompt injection.
    """
    if not text or not text.strip():
        return f"{_OPEN_DELIMITER}[No content provided]{_CLOSE_DELIMITER}"

    cleaned = text

    # Step 1: Strip all injection patterns — replace matches with a safe placeholder
    for pattern in _COMPILED_PATTERNS:
        cleaned = pattern.sub("[CONTENT REMOVED]", cleaned)

    # Step 2: Collapse repeated whitespace and normalize line breaks
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)   # max 2 consecutive newlines
    cleaned = re.sub(r" {2,}", " ", cleaned)         # collapse multiple spaces
    cleaned = cleaned.strip()

    if not cleaned:
        logger.warning("sanitize_for_llm: input was entirely composed of injection patterns.")
        cleaned = "[Content removed due to policy violation]"

    # Step 3: Wrap in delimiters
    sanitized = f"{_OPEN_DELIMITER}\n{cleaned}\n{_CLOSE_DELIMITER}"

    if cleaned != text.strip():
        logger.warning(
            "sanitize_for_llm: one or more injection patterns were stripped from input. "
            f"Original length: {len(text)}, cleaned length: {len(cleaned)}"
        )

    return sanitized
