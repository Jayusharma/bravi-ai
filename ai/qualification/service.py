import google.generativeai as genai
import os
import json
from dotenv import load_dotenv

from .models import QualifyRequest, QualifyResponse
from .prompt import build_prompt, SYSTEM_INSTRUCTION
from . import parser

load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Dedicated qualification model. response_mime_type forces JSON output —
# this is the first half of the JSON firewall.
_model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=SYSTEM_INSTRUCTION,
    generation_config={
        "temperature": 0.1,
        "max_output_tokens": 1024,
        "response_mime_type": "application/json",
    },
)


async def qualify(req: QualifyRequest) -> QualifyResponse:
    prompt = build_prompt(req)

    try:
        # async call — never block the event loop with a sync Gemini call
        response = await _model.generate_content_async(prompt)

        text = (response.text or "").strip()
        if not text:
            return parser.fallback("AI returned an empty response. Sent to manual review.")

        parsed = json.loads(text)  # firewall: invalid JSON raises below

        usage = getattr(response, "usage_metadata", None)
        input_tokens = getattr(usage, "prompt_token_count", 0) or 0
        output_tokens = getattr(usage, "candidates_token_count", 0) or 0

        return parser.build_response(parsed, input_tokens, output_tokens)

    except json.JSONDecodeError:
        print(f"Qualify: Gemini returned unparseable JSON: {text!r}")
        return parser.fallback("AI returned unparseable response. Sent to manual review.")

    except Exception as e:
        print(f"Qualify: Gemini call failed: {e}")
        return parser.fallback(f"AI failed: {e}. Sent to manual review.")
