import google.generativeai as genai
import os
import json
from dotenv import load_dotenv

from .models import ReplyRequest, ReplyResponse
from .prompt import build_prompt, SYSTEM_INSTRUCTION
from . import parser

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Slightly higher temperature than qualification — we want a natural, human tone.
_model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=SYSTEM_INSTRUCTION,
    generation_config={
        "temperature": 0.3,
        "max_output_tokens": 1024,
        "response_mime_type": "application/json",
    },
)


async def reply(req: ReplyRequest) -> ReplyResponse:
    is_email = req.channel.upper() == "EMAIL"
    prompt = await build_prompt(req.enquiry_id, req.channel)

    try:
        # async call — never block the event loop with a sync Gemini call
        response = await _model.generate_content_async(prompt)

        text = (response.text or "").strip()
        if not text:
            return parser.fallback("AI returned an empty response. Left for a human.")

        parsed = json.loads(text)  # firewall: invalid JSON raises below
        return parser.build_response(parsed, is_email)

    except json.JSONDecodeError:
        print(f"Reply: Gemini returned unparseable JSON: {text!r}")
        return parser.fallback("AI returned unparseable response. Left for a human.")

    except Exception as e:
        print(f"Reply: Gemini call failed: {e}")
        return parser.fallback(f"AI failed: {e}. Left for a human.")
