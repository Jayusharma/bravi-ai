import os
from dotenv import load_dotenv

from .models import QualifyRequest

load_dotenv()

# Business context is interpolated into the system instruction. Same default
# string the NestJS backend used, so classification behaviour is unchanged.
# (Later layers will drive this per-business from business_id.)
BUSINESS_CONTEXT = os.getenv(
    "QUALIFICATION_BUSINESS_CONTEXT",
    "a product-based company selling goods and services",
)

SYSTEM_INSTRUCTION = (
    f"You are a lead qualification AI for {BUSINESS_CONTEXT}. "
    "Your primary job is to CAPTURE business leads — never let a real business "
    "enquiry slip through. Classify every message that shows any commercial, "
    "product, pricing, or service interest as a lead. Only reject clear spam, "
    "promotions, OTPs, and auto-replies. Respond with ONLY valid JSON."
)


def build_prompt(req: QualifyRequest) -> str:
    return f"""You are analyzing a message received by a business on {req.channel}.

FROM: {req.from_}
MESSAGE:
{req.body}

DECISION RULES (read carefully):

Mark isLead=true (confidence 75-95) when the message shows ANY of these signals:
- Asking about price, pricing, rates, quotation, quote, cost, charges
- Asking for samples, catalogue, brochure, product list, demo
- Asking about availability, stock, delivery, shipping, lead time
- Mentioning a quantity, bulk order, wholesale, retail requirement
- Asking how to buy, place an order, or make a purchase
- Asking about specifications, features, quality of a product or service
- Requesting a callback, meeting, or follow-up for business purposes
- Sending a business enquiry even if phrased informally (e.g. "send me pricing", "what is the rate")
- Hindi/Urdu/regional business messages about products or prices

Mark isLead=false (confidence 70-95) ONLY for clear non-business:
- Spam or promotional bulk messages
- Auto-replies and system notifications
- OTPs or verification codes
- Pure personal conversation with no business intent
- Unsubscribe or opt-out messages

For ambiguous short messages like just "hi" or "hello" with no context:
- isLead=false, confidence=60 (route to review so no message is lost)

NEVER mark a real pricing, product, or order request as NOT a lead. When in doubt, mark as lead.

Return JSON:
{{
  "isLead": true or false,
  "confidence": 0 to 100,
  "intent": one of "PRODUCT_INQUIRY" | "PRICING_REQUEST" | "BULK_ORDER" | "SHIPPING_INQUIRY" | "GENERAL_INFO" | "COMPLAINT" | "APPOINTMENT" | "DOCUMENT_SUBMIT" | "RETURN_REFUND" | "PARTNERSHIP" | "UNKNOWN",
  "urgency": 1 to 5,
  "priority": 1 to 10,
  "reason": "one sentence explaining your classification decision",
  "extractedData": {{
    "contactName": "name or null",
    "companyName": "company or null",
    "productRequested": "product or null",
    "quantitySignal": "quantity mentioned or null",
    "areaLocality": "location or null",
    "budgetSignal": "budget hints or null",
    "timelineSignal": "timeline mentions or null"
  }},
  "detectedLanguage": "en" or "hi" or relevant ISO code
}}"""
