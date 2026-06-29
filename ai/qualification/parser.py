from .models import QualifyResponse, ExtractedData

VALID_INTENTS = {
    "PRODUCT_INQUIRY", "PRICING_REQUEST", "BULK_ORDER", "SHIPPING_INQUIRY",
    "GENERAL_INFO", "COMPLAINT", "APPOINTMENT", "DOCUMENT_SUBMIT",
    "RETURN_REFUND", "PARTNERSHIP", "UNKNOWN",
}


def _clamp(value, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _normalize_intent(raw) -> str:
    upper = str(raw or "").upper().replace(" ", "_")
    return upper if upper in VALID_INTENTS else "UNKNOWN"


def _extracted(data) -> ExtractedData:
    data = data if isinstance(data, dict) else {}

    def pick(key):
        value = data.get(key)
        # Gemini often returns the literal string "null"; treat as empty.
        if value in (None, "", "null", "None"):
            return None
        return value

    return ExtractedData(
        contactName=pick("contactName"),
        companyName=pick("companyName"),
        productRequested=pick("productRequested"),
        quantitySignal=pick("quantitySignal"),
        areaLocality=pick("areaLocality"),
        budgetSignal=pick("budgetSignal"),
        timelineSignal=pick("timelineSignal"),
    )


def build_response(parsed: dict, input_tokens: int, output_tokens: int) -> QualifyResponse:
    """Normalize a parsed Gemini JSON object into a validated QualifyResponse."""
    return QualifyResponse(
        isLead=bool(parsed.get("isLead", False)),
        confidence=_clamp(parsed.get("confidence", 50), 0, 100, 50),
        intent=_normalize_intent(parsed.get("intent")),
        urgency=_clamp(parsed.get("urgency", 3), 1, 5, 3),
        priority=_clamp(parsed.get("priority", 5), 1, 10, 5),
        reason=parsed.get("reason") or "AI classification complete",
        extractedData=_extracted(parsed.get("extractedData")),
        detectedLanguage=parsed.get("detectedLanguage") or "en",
        inputTokens=int(input_tokens),
        outputTokens=int(output_tokens),
    )


def fallback(reason: str) -> QualifyResponse:
    """Safe fallback: confidence 0 makes the backend route the message to
    NEEDS_REVIEW so nothing is ever lost."""
    return QualifyResponse(
        isLead=False,
        confidence=0,
        intent="UNKNOWN",
        urgency=3,
        priority=5,
        reason=reason,
        extractedData=ExtractedData(),
        detectedLanguage="unknown",
        inputTokens=0,
        outputTokens=0,
    )
