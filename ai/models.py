from pydantic import BaseModel


# ─────────────────────────────────────────────────────────────────────
# Decision models (used by /decide — the future automation layer)
# ─────────────────────────────────────────────────────────────────────

class DecisionRequest(BaseModel):
    enquiry_id: str
    business_id: str | None = None
    trigger: str


class DecisionResponse(BaseModel):
    action: str
    draft: str | None
    reasoning: str
    confidence: float

