# Enquiry Hub — AI Layer & Automation Module Build Plan
### Build-and-learn edition

**Built by hand, layer by layer. Each layer runs on its own and teaches one fundamental — to builder depth, not scientist depth.**
The dial: **deep where it touches your hands, gist where it doesn't.** You learn enough to build anything. Not more, not less.

---

## The system in one paragraph

NestJS stays the **body** — auth, ingestion, channels, state machine, WebSockets, the automation *engine*. A Python FastAPI service is the **brain** — embeddings, RAG retrieval, the Gemini decision call. They share **one Postgres**, talk over **HTTP** (gRPC is a scale problem you don't have). Brain never touches sockets; body never touches embeddings. The copilot page and voice agent later reuse the same brain — new adapters, not new intelligence.

## Locked decisions (not reopened)
- AI reply = **draft-for-agent-approval.** Auto-send is a future per-feature flag, off by default.
- **HTTP**, 10s timeout, fail to `null`, body degrades gracefully.
- **Gemini Flash** by default; Pro only when a task provably needs it.
- **asyncpg + raw SQL** in Python. No ORM while learning a language.
- **Two token tiers:** critical (qualification, scoring) = unlimited; comfort (drafts, decisions, copilot) = flagged + limited.

## The depth dial (read once, applies everywhere)
| Concept | Learn (builder depth) | Skip (scientist depth) |
|---|---|---|
| Python | syntax, async, classes, pipelines, errors | metaclasses, GIL internals, decorators-from-scratch |
| Async | why blocking freezes the loop, when to await, pools | writing your own event loop |
| Prompt eng. | structure, constraints, JSON forcing, fix-loop | (go deep — it's all builder-level) |
| RAG | meaning→vectors, cosine, chunk→store→retrieve→inject | transformer math that makes the vectors |
| Edge cases | all of them, in context | — |

---

## Layer 0 — The Pipe
**Build:** FastAPI app with `/health` + `/decide` (returns a hardcoded `DecisionResponse`). NestJS `AIServiceClient` that POSTs with a 10s timeout and returns `null` on any failure.
**Learn this:** Python module/import layout, Pydantic models, FastAPI routing, inter-service HTTP.
**Skip this:** ASGI server internals, uvicorn worker tuning.
**Edge cases to handle:** Python service down → NestJS returns `null`, not a 500. Timeout fires (don't hang forever). Malformed request → Pydantic rejects at the boundary before your code runs.
**Done when:** NestJS gets the decision back, and *still answers correctly when you kill the Python process.*

## Layer 1 — The Real Decision (no grounding yet)
**Build:** asyncpg **pool**. `/decide` reads the conversation from Postgres → builds a prompt → calls Gemini with a structured JSON schema → parses → returns. Wrap the parse in the **JSON firewall**.
**Learn this:** connection pools (why not one-per-request), the Gemini SDK, structured outputs, **async-vs-blocking** (a blocking call inside `async def` freezes the whole service), what a pipeline *is* (stage → stage → stage).
**Skip this:** Postgres query planner internals, custom retry/backoff libraries (a simple retry is enough now).
**Edge cases to handle:** Gemini returns non-JSON or wrapped-in-markdown → firewall escalates with confidence 0.0 instead of crashing. Empty conversation. Pool exhausted under load. Gemini call times out.
**Done when:** a real conversation produces a valid decision, and a deliberately broken model response *escalates* instead of crashing.

## Layer 2 — The Gateway (cost control before it can hurt you)
**Build:** `BusinessAIConfig` (flags + comfort limits + counters; **no limit on qualification — intentional**). One `ai_call(business_id, feature, prompt)` chokepoint: critical features skip all checks; comfort features go flag → daily → monthly → run. Log tokens on every call.
**Learn this:** the three-tier model (Heartbeat / Productivity / Premium), usage metering, separating the pool you can't limit from the one you can.
**Skip this:** billing systems, Stripe metering — that's later.
**Edge cases to handle:** qualification must run at zero comfort-tokens-left. Comfort feature over limit → return `null`, system keeps working (graceful, not crash). Counter race conditions (atomic update).
**Done when:** qualification fires regardless of limits; a comfort feature degrades silently when capped.

## Layer 3 — Grounding (RAG)
**Build:** `CREATE EXTENSION vector` + `knowledge_chunks` + **IVFFlat index**. `EmbeddingService` (store = `retrieval_document`, query = `retrieval_query`). `ContextBuilder`: embed query → top-3 chunks via `<=>` → inject. Hard limits: last 10 messages, top 3 chunks, truncate chunks.
**Learn this:** embeddings (similar meaning → nearby vectors), cosine similarity, RAG write-phase vs read-phase, why context discipline is cheaper *and* better.
**Skip this:** how the embedding model is trained, vector-DB internals, alternative index types beyond knowing IVFFlat exists.
**Edge cases to handle:** zero chunks retrieved (new business, empty store) → AI must still respond sensibly. Wrong `task_type` quietly degrades retrieval. Chunk too long blows the token budget. Stale chunks after info changes.
**Done when:** "how much is premium?" returns the real price *you stored in a chunk* — never invented.

## Layer 4 — The Engine (the automation module itself)
**Build (NestJS):** BullMQ jobs watching conversation state (`no agent reply in X`, `no customer reply in Y`, `stage changed`, `manual`). Trigger → call brain → `{action, draft, reasoning, confidence, snooze_hours}` → **action executor** routes by channel rule (draft→approval queue; WhatsApp window closed→approved template, never free-form; email→no window; escalate→manager; snooze→re-arm; do_nothing→log). Confidence below threshold → override to escalate.
**Learn this:** trigger → condition → action; why the **engine** watches, not the AI; channel rules living in adapters, not the AI; defensive defaults.
**Skip this:** distributed scheduling, multi-worker coordination — single worker is fine now.
**Edge cases to handle:** duplicate triggers (idempotency). Closed WhatsApp window must never send free-form. Lead replies *while* a follow-up is queued (cancel it). Snooze loop that never ends. Manager offline on escalate.
**Done when:** a real "quiet 2 days" lead produces a channel-correct action with a human-reviewable draft, and a closed window never sends free-form.

## Layer 5 — The Loop (it actually gets smarter)
**Build:** log every outcome (accepted/edited/rejected). Accepted-unedited drafts → stored as few-shot examples fed back into the context builder. Resolved conversations → folded into the knowledge store. Confidence thresholds tighten as the track record proves out.
**Learn this:** feedback loops; "smarter" = better context + better examples, not the model absorbing your business; why fine-tuning is a much-later/maybe-never question.
**Skip this:** fine-tuning pipelines, RLHF, eval frameworks (a simple accept-rate metric is enough now).
**Edge cases to handle:** a bad accepted draft poisoning examples (cap + curate). Example set growing past the token budget. Feedback from one business leaking into another (scope by business_id).
**Done when:** accepted drafts measurably shift new drafts toward your agents' real voice.

## Layer 6 — Same Brain, New Faces (switch on later)
Not now — but designed for, so nobody redesigns:
- **Copilot page** = same brain + chat UI over the same RAG and conversation memory.
- **Voice agent** = same brain at the channel layer. Brain is shared; the hard part (Twilio media streams, Gemini Live, sub-second latency, interruption handling) is voice-specific and stays out of V1.

---

## Folder shape (Python service)
```
ai-service/
├── main.py                 # FastAPI app, routes
├── models.py               # Pydantic request/response
├── db.py                   # asyncpg pool
├── services/
│   ├── embedding.py        # embed(), store_chunk()
│   ├── vector_store.py     # retrieve()
│   ├── context_builder.py  # assembles the prompt
│   ├── ai.py               # Gemini call + JSON firewall
│   └── gateway.py          # the one ai_call() chokepoint
└── .env                    # GEMINI_API_KEY, DATABASE_URL
```

## How to run this
**By hand: Layers 0, 1, 2** — they teach the mechanics; you write every line; chat with me when a concept is fuzzy. **Tool-accelerate: Layers 3, 4, 5** — more code, fewer new concepts; you read and catch mistakes because you built the foundation. Frontend: AI-assisted throughout — it's not your learning gap.

**The discipline that keeps "learn everything" from becoming endless tangents:** one test — *does understanding this change the code I write in the next sitting?* Yes → learn it now. No → one-line gist, move on.

**Whole-plan done:** Layers 0–4 running on one real test business. That is the V2 brain *and* the V1 automation module — built once, by hand, no rebuild.