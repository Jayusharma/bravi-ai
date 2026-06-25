from db import get_pool

async def build_prompt(enquiry_id: str, trigger: str) -> str:
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT content, direction, "createdAt"
            FROM "ConversationMessage"
            WHERE "enquiryId" = $1
            AND "isDeleted" = false
            ORDER BY "createdAt" ASC
            LIMIT 20
        """, enquiry_id)

    if not rows:
        conversation_text = "No messages yet."
    else:
        conversation_text = "\n".join([
            f"{row['direction']}: {row['content']}"
            for row in rows
        ])

    prompt = f"""
You are an AI sales assistant helping a business manage their leads.

CONVERSATION HISTORY:
{conversation_text}

TRIGGER: {trigger}

TASK:
Analyze this conversation and decide the best next action.

IMPORTANT GROUNDING RULE:
If the conversation does not give you enough information to act confidently,
choose "escalate" and lower your confidence. Never invent prices, product
details, or promises that are not present in the conversation.

Return ONLY valid JSON. No explanation. No markdown.

{{
  "action": "draft_reply" or "escalate" or "snooze" or "do_nothing",
  "draft": "the reply text if action is draft_reply, otherwise null",
  "reasoning": "one sentence explaining why you chose this action",
  "confidence": a number between 0.0 and 1.0
}}
"""

    print("prompt is" , prompt )
    return prompt