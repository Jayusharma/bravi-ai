from pydantic import BaseModel


class ReplyRequest(BaseModel):
    enquiry_id: str
    channel: str  # "WHATSAPP" | "EMAIL"
    business_id: str | None = None


class ReplyResponse(BaseModel):
    action: str              # "send" | "escalate"
    reply: str | None        # the message body, null if escalating
    subject: str | None      # email subject; null for WhatsApp
    confidence: float        # 0.0 - 1.0
    reasoning: str
