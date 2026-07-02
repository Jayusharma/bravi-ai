# pyrefly: ignore [missing-import]
from fastapi import FastAPI
from db import get_pool, close_pool
from services.ai import call_gemini
from services.context import build_prompt
from models import DecisionRequest, DecisionResponse
from qualification import qualify as qualify_message, QualifyRequest, QualifyResponse
from reply import reply as generate_reply, ReplyRequest, ReplyResponse

app = FastAPI()


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


@app.post("/qualify", response_model=QualifyResponse)
async def qualify_route(req: QualifyRequest):
    return await qualify_message(req)


@app.post("/reply", response_model=ReplyResponse)
async def reply_route(req: ReplyRequest):
    return await generate_reply(req)


@app.post("/decide", response_model=DecisionResponse)
async def decide(req: DecisionRequest):
    prompt = await build_prompt(req.enquiry_id, req.trigger)
    decision = await call_gemini(prompt)

    return DecisionResponse(
        action=decision.get("action", "escalate"),
        draft=decision.get("draft"),
        reasoning=decision.get("reasoning", "No reasoning provided"),
        confidence=decision.get("confidence", 0.0),
    )
