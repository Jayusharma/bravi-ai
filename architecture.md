# ARCHITECTURE.md — EnquiryHub

> **This file describes the code as it actually is** (verified against source in the Phase 0 audit,
> `docs/audit/`). Where a behaviour is planned but not built, it is marked **[PLANNED]** with the block
> that will build it. On any conflict between prose elsewhere in the repo and this file, this file wins.
> This document replaced an earlier, largely aspirational architecture note (it described a rule-engine
> pipeline, a routing `WebhookService`, an `automation.worker.ts`, and a `QUOTATION_SENT` follow-up
> scheduler that do not exist). See `docs/audit/02-risk-register.md` for the gaps.

---

## What this is

Single-tenant lead-qualification + multi-channel messaging CRM. One dedicated instance per client.
Inbound WhatsApp (Twilio **and** Meta Cloud API) + Email (SendGrid) → contact resolution → AI
qualification → Enquiry conversation thread → agent reply / 90-second AI auto-reply → delivery
tracking. Plus internal staff chat, message templates, channel-connection management, and a DLQ.

**Stack:** NestJS 11 · Prisma 7 + **pg driver adapter** · PostgreSQL · BullMQ + Redis · Socket.IO
(Redis adapter) · CASL · Python FastAPI + Gemini (the "brain") · Next.js 16 + React 19 (Zustand +
socket.io-client). Full inventory: `docs/audit/00-inventory.md`.

---

## Data flow — as built

```
INBOUND
─────────────────────────────────────────────────────────────────────
Provider webhook (Twilio | SendGrid | Meta)                [⚠ UNVERIFIED — R1]
  → WebhookController.handle*()          webhooks/webhook.controller.ts
      ├── IdempotencyMiddleware synthesizes key from MessageSid/wamid/Message-ID
      ├── channel on/off toggle check (ChannelConnection.status)
      └── normalizer → IngestMessageDto
  → IngestionService.ingest()            Ingestion/ingestion.service.ts
      ├── ContactService.resolve(channel, from)  → find-or-create Contact + ContactChannel
      ├── known contact + OPEN enquiry?  → PATH A: append ConversationMessage (no AI)
      ├── recently CLOSED_LOST (≤30d)?   → PATH B: reopen enquiry (+ REOPENED timeline)
      └── else                           → SLOW PATH: create InboundMessage {PENDING},
                                            enqueue BullMQ 'qualification'
  → QualificationProcessor → QualificationService.qualify()   [AI-ONLY — rule layers unbuilt, R13]
      ├── QualificationAIClient → POST {AI}/qualify (Python → Gemini)
      ├── write QualificationResult (tokens, cost, intent, confidence)
      └── if REAL_ENQUIRY → emit 'enquiry.qualified'
  → EnquiryService.handleQualified()     enquiry/enquiry.service.ts   (@OnEvent)
      ├── race-guard: open enquiry exists? → append
      └── else create Enquiry {NEW} + first ConversationMessage + CREATED timeline
                                            → emit 'enquiry.created'
  → AppEventHandler → AppGateway.emit(MESSAGE_NEW / NOTIFICATION / CONVERSATION_*)

FIRST-TOUCH AUTOMATION
─────────────────────────────────────────────────────────────────────
'enquiry.created' → AiReplyScheduler  → BullMQ 'ai-reply' delayed 90s (jobId per enquiry)
  → AiReplyProcessor (fires at 90s)
      ├── re-validate: not closed, no outbound yet (human beat it → skip)
      ├── AIService.getReply() → POST {AI}/reply (Python → Gemini)
      └── if action=send & confidence≥threshold → EnquiryService.addAiReply()  → outbound pipeline
    NOTE: ungrounded, no citations, no AgentRun. [Block 7 rebuilds on grounded rails]

OUTBOUND
─────────────────────────────────────────────────────────────────────
Socket outbound:send (primary)          websocket/app.gateway.ts
  → OutboundSendService.send()          outbound/outbound-send.service.ts
      ├── resolve channel/body (draft or direct), resolve recipient from ContactChannel
      ├── EnquiryService.addOutboundMessage() → ConversationMessage {OUTBOUND, PENDING}
      │        + MESSAGE_SENT timeline + emit 'message.outbound'
      └── OutboundService.enqueue() → BullMQ OUTBOUND_QUEUE   [⚠ NO 24h WINDOW CHECK — R2]
  → OutboundProcessor.process()          outbound/outbound.processor.ts
      → ChannelRouterService.send() → AdapterFactory → adapter
            provider META_WHATSAPP → MetaWhatsAppAdapter (Graph API, creds from connection)
            else WHATSAPP           → WhatsAppAdapter (Twilio, env)
            EMAIL                    → EmailAdapter (SendGrid)   [adapter IS wired]
      ├── success → ConversationMessage {SENT, externalId}; emit 'outbound.sent'
      ├── transient fail → throw → BullMQ retry (custom backoff 1s/4s/16s, 3 attempts)
      └── exhausted → onJobFailed → {FAILED} + OutboundDeadLetter + emit 'outbound.failed'

DELIVERY RECEIPTS
─────────────────────────────────────────────────────────────────────
Twilio → POST /outbound/webhooks/whatsapp/delivery  [signature VERIFIED — outbound.controller.ts:148]
SendGrid → POST /outbound/webhooks/email/delivery   [unverified]
  → DeliveryTrackingService → OutboundService.updateDeliveryStatusByExternalId (rank-guarded)
Meta delivery/read → arrives at /webhook/whatsapp/meta and is DROPPED  [NOT TRACKED — R8]
```

---

## Module boundaries — what each owns

| Module | Owns | Never does |
|---|---|---|
| `webhooks` | Normalize provider payload → `IngestMessageDto`; toggle check | Business logic, sending |
| `Ingestion` | Contact resolution, `InboundMessage`, fast/slow path routing | Qualification internals, sending |
| `qualification` | AI classify, `QualificationResult`, emit `enquiry.qualified` | Create Enquiry, send |
| `enquiry` | Enquiry CRUD, **FSM** (`enquiry.state.ts`), conversation thread, timeline | Call Twilio/SendGrid directly |
| `outbound` | Adapters, routing, queue, delivery status, drafts, DLQ | Know Enquiry rules |
| `channels` | `ChannelConnection` CRUD, toggle, **encrypted credentials** | Send/receive |
| `contact` | Contact + ContactChannel CRUD, exact-match resolve | Qualification, messaging |
| `automation` | 90s first-touch auto-reply (BullMQ delayed) | Import Nest into a worker file (there is none — R6) |
| `websocket` | **All** `@SubscribeMessage` handlers (single gateway) | REST, business logic |
| `events` | **All** `@OnEvent` listeners → socket emits (single file) | Domain writes |
| `casl` | Compute abilities from role+permissions (DB-driven) | Routing, auth |
| `permission` | Permission + RolePermission CRUD | Compute abilities |
| `user` | User CRUD, bcrypt | Token issue |
| `auth` | Login, JWT issue + strategy | User management |
| `template`, `chat`, `search`, `storage`, `messaging` | See `docs/audit/00-inventory.md` | — |

**Realtime convention (holds):** every `@SubscribeMessage` lives in `websocket/app.gateway.ts`; every
`@OnEvent` lives in `events/app.event-handler.ts`. Domain listeners that stay in their service:
`message.outbound` (OutboundService), `enquiry.qualified` (EnquiryService).

---

## Schema contracts — real invariants

**Contact identity** — `Contact` (person) → `ContactChannel[]`; unique `(channel, identifier)`; resolve
finds ContactChannel first, then Contact. Email lowercased; **phone is NOT E.164-normalized yet**, and
there is **no cross-channel merge** (`merge-contact.dto.ts` is an unused DTO). Cross-channel identity =
**[PLANNED Block 4]**.

**Enquiry threading** — one Contact → at most one open enquiry (`status NOT IN (CONVERTED,
CLOSED_LOST)`); new message → append; else create. `version` = optimistic concurrency; `lastActivityAt`
on every action; `lastCustomerReplyAt` on INBOUND; `firstResponseAt` once on first OUTBOUND.

**Enquiry FSM** — the source of truth is `enquiry/enquiry.state.ts` (`ENQUIRY_TRANSITIONS`).
`statusChange()` validates the transition, checks `version`, and writes an `EnquiryTimeline` row.
**Exception to watch:** the ingestion fast-path auto-transitions (`STALE→OPEN`, etc.) update status
**without** a timeline event (R14) — the one place the "timeline alongside every status change" rule is
violated. CLOSED_LOST → OPEN is an allowed reopen.

**Qualification** — `QualificationResult` is 1:1 with `InboundMessage`. Today `finalLayer` is **always**
`AI_CLASSIFIER`; the rule-engine layers (`RuleType`, `QualificationLayer`) are modeled but never run
(R13). Token counts + `estimatedCostUsd` are written per classification.

**Delivery lifecycle** — `PENDING → SENT → DELIVERED → READ`, or `FAILED`. Rank-guarded so status never
regresses (`outbound.service.ts:195`). `externalId` = provider message ID (indexed, **not unique**).
FAILED messages are not auto-retried — manual retry only (`/outbound/messages/:id/retry`).

**Credentials** — `ChannelConnection.credentials` is one AES-256-GCM blob (`common/crypto/credential-cipher.ts`),
never returned to the client (masked). SendGrid stores `{apiKey}`; Meta stores `{accessToken, verifyToken}`
— **no `appSecret`**, which Block 1 must add for inbound-Meta HMAC (R1).

---

## Non-negotiable rules (enforced or intended)

- **Prisma pg adapter** — services use injected `PrismaService` (already pg-adapter). Any worker/script
  must construct `new PrismaClient({ adapter: new PrismaPg(new Pool(...)) })`. Never bare `new PrismaClient()`.
- **Outbound via events** — emit `message.outbound`; never call Twilio/SendGrid/Meta from a service.
- **Auth** — global `JwtAuthGuard`; `@Public()` opts out. CASL is applied per-controller today and
  **must** cover every protected route — two controllers currently slip it (R4); Block 1 makes CASL
  global. `@CheckAbility({action, subject})` declares the rule.
- **Enquiry status** — never write `status` without an `EnquiryTimeline` row and an `ENQUIRY_TRANSITIONS`
  check.
- **Contact is a person, not an address** — resolve ContactChannel → Contact before touching
  InboundMessage/Enquiry.
- **Realtime** — one gateway for handlers, one file for listeners.

---

## Known-critical caveats (full list: `docs/audit/02-risk-register.md`)

1. `POST /users` is `@Public()` with client-settable `role` → **unauthenticated ADMIN creation** (R0).
2. Inbound webhooks + `POST /ingestion/message` verify **no signature** (R1); billing-DoS surface.
3. `WhatsAppWindowService.isWindowOpen()` exists but is **never called** in the send path (R2).
4. JWT sign secret `JWT_SECRET` ≠ verify secret `JWT_SECERET`; `'dev-secret'` fallback (R3).
5. `npm run worker` → **non-existent** `automation.worker.ts`; workers run **in-process** (R6).
6. No graceful shutdown (R7); no env validation (R9); no throttler/helmet (R10).

## Redis persistence caveat (still valid)
Delayed BullMQ jobs (the 90s auto-reply timer, any future follow-ups) live only in Redis. If Redis has
no AOF/RDB persistence, a restart silently drops them — there is no Postgres-of-record for in-flight
timers. Enable persistence or use managed Redis before go-live.

---

## Build order

The forward plan is eleven blocks; see `docs/audit/03-plan.md` (format) and `docs/audit/04-decisions.md`
(ADRs). Nothing ships before **Block 1 — Trust & observability**.
