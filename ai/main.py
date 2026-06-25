# pyrefly: ignore [missing-import]
from fastapi import FastAPI
from pydantic import BaseModel
from db import get_pool, close_pool
from services.ai import call_gemini, qualify_message
from services.context import build_prompt

app = FastAPI()

class DecisionRequest(BaseModel):
    enquiry_id: str 
    business_id: str | None = None
    trigger: str 


class DecisionResponse(BaseModel):
    action: str 
    draft: str | None 
    reasoning: str 
    confidence: float 

@app.on_event("startup")
async def startup():
    await get_pool()
    print("database connected ")

@app.on_event("shutdown")
async def shutdown():
    await close_pool()
    print("database disconnected ")

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/decide")
async def decide(req: DecisionRequest):
     prompt = await build_prompt(req.enquiry_id , req.trigger)
     decision = await call_gemini(prompt)

     return DecisionResponse(
        action=decision.get("action", "escalate"),
        draft=decision.get("draft"),
        reasoning=decision.get("reasoning", "No reasoning provided"),
        confidence=decision.get("confidence", 0.0)
     )

class TestRequest(BaseModel):
    message: str

@app.post("/test-ai")
async def test(req: TestRequest):
    if not req.message:
        return "No message provided"
    print("qualifying message: ", req.message)
    response = await qualify_message(req.message) 
    return response 