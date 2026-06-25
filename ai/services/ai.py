import google.generativeai as genai 
import os 
import json 
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key = os.getenv("GOOGLE_API_KEY"))
model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config={
        "temperature": 0.1,
        "max_output_tokens": 1024,
        "response_mime_type": "application/json"
    }
)


async def call_gemini(prompt:str) -> dict:
    try:
        response = model.generate_content(prompt)
        
        # raw text gemini returned
        text = response.text.strip()
        decision = json.loads(text)
        return decision

    except json.JSONDecodeError:
        # gemini returned something unparseable
        # never crash — escalate to human instead
        print(f"Gemini returned unparseable response: {text}")
        return {
            "action": "escalate",
            "draft": None,
            "reasoning": "AI returned unparseable response — escalated to human",
            "confidence": 0.0
        }
    
    except Exception as e:
        # any other error — network, API limit, etc
        print(f"Gemini call failed: {e}")
        return {
            "action": "escalate",
            "draft": None,
            "reasoning": f"AI call failed: {str(e)}",
            "confidence": 0.0
        }


async def qualify_message(message: str) -> dict:
    prompt = f"""
    Analyze the following incoming customer message and qualify if it is a real sales/business lead.
    
    Customer Message: "{message}"
    
    Respond with a JSON object containing:
    - "is_lead": boolean (true if it represents a real business inquiry or lead, false if it is spam, greetings, chit-chat, or unrelated)
    - "category": string (e.g., "pricing", "booking", "general_info", "spam", "other")
    - "reasoning": string (explanation of why it is or isn't a lead)
    - "confidence": float (0.0 to 1.0)
    - "suggested_reply": string or null (a short suggested draft response if it's a real lead, otherwise null)
    """
    return await call_gemini(prompt)