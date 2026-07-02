from db import get_pool

SYSTEM_INSTRUCTION = (
    "You are a friendly, professional sales assistant writing the FIRST reply "
    "to a brand-new lead who messaged a business and hasn't heard back from a "
    "human yet. Your reply must make the lead feel heard and reassured that the "
    "team will help them shortly. Be warm, concise, and natural — like a real "
    "salesperson, not a bot. Respond with ONLY valid JSON."
)


async def _fetch_conversation(enquiry_id: str) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT content, direction, "createdAt"
            FROM "ConversationMessage"
            WHERE "enquiryId" = $1
            AND "isDeleted" = false
            ORDER BY "createdAt" ASC
            LIMIT 20
            """,
            enquiry_id,
        )

    if not rows:
        return "No messages yet."

    return "\n".join(f"{row['direction']}: {row['content']}" for row in rows)


async def build_prompt(enquiry_id: str, channel: str) -> str:
    conversation_text = await _fetch_conversation(enquiry_id)
    is_email = channel.upper() == "EMAIL"

    subject_rule = (
        'This is an EMAIL. You MUST write a short, relevant "subject" line for the reply.'
        if is_email
        else 'This is a WHATSAPP message. "subject" MUST be null.'
    )

    return f"""A new lead reached out on {channel} and no human has replied yet.
Write the first response that keeps them engaged until an agent takes over.

CONVERSATION HISTORY:
{conversation_text}

CHANNEL RULE:
{subject_rule}

HOW TO REPLY:
- Acknowledge what they asked about and make them feel heard.
- Reassure them that the team will assist them shortly.
- Be warm and human; keep it brief.

IMPORTANT GROUNDING RULE:
Never invent prices, product details, availability, or promises that are not
present in the conversation. If you cannot write a helpful reply without
inventing such specifics, set "action" to "escalate" and leave "reply" null.

Return ONLY valid JSON. No explanation. No markdown.

{{
  "action": "send" or "escalate",
  "reply": "the message body if action is send, otherwise null",
  "subject": "{'the email subject line' if is_email else 'null'}",
  "confidence": a number between 0.0 and 1.0,
  "reasoning": "one sentence explaining your decision"
}}
"""
