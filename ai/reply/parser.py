from .models import ReplyResponse


def _clamp_confidence(value) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def build_response(parsed: dict, is_email: bool) -> ReplyResponse:
    """Normalize a parsed Gemini JSON object into a validated ReplyResponse."""
    action = str(parsed.get("action", "escalate")).lower()
    if action not in ("send", "escalate"):
        action = "escalate"

    reply = parsed.get("reply")
    if action != "send" or not reply:
        reply = None
        action = "escalate" if not reply else action

    subject = parsed.get("subject") if is_email else None
    if subject in ("", "null", "None"):
        subject = None

    return ReplyResponse(
        action=action,
        reply=reply,
        subject=subject,
        confidence=_clamp_confidence(parsed.get("confidence", 0.0)),
        reasoning=parsed.get("reasoning") or "No reasoning provided",
    )


def fallback(reason: str) -> ReplyResponse:
    """Safe fallback: escalate so the backend leaves the lead for a human."""
    return ReplyResponse(
        action="escalate",
        reply=None,
        subject=None,
        confidence=0.0,
        reasoning=reason,
    )
