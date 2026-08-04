# EnquiryHub — Phase 0 Audit

**The truth about the current state of the codebase, with file paths and line numbers, and the plan built from it.**

This is read-only work. Nothing here was fixed — problems are reported with a file path, not patched. Every `file:line` reference is checkable against the code. Risks are tagged `R0`–`R14` and referenced throughout.

Sections: 1) what the code actually is · 2) module inventory · 3) gap analysis against the build spec · 4) risk register · 5) execution plan · 6) decisions.

---

## 1. What the code actually is

The product description, stack, and module map were deliberately left out of the spec — here is what the code shows.

**Product.** A single-tenant lead-qualification and multi-channel messaging CRM, one dedicated instance per client. Inbound messages arrive over WhatsApp (Meta Cloud API — Twilio was removed from the system during Block 1; see decisions) and Email (SendGrid). Each is resolved to a person, qualified by AI, and folded into an Enquiry — a conversation thread. A human replies, or a 90-second AI auto-reply keeps the lead warm. Delivery is tracked back. Around this sit an internal staff chat, message templates, channel-connection management, and a dead-letter queue.

**Stack.**
- Backend (`backend/`) — NestJS 11, Prisma 7 on the **pg driver adapter** (`database/prisma.service.ts:10-15`, correct), BullMQ + Redis, Socket.IO with a Redis adapter (`main.ts:19-25`), CASL, passport-jwt, Swagger.
- AI brain (`ai/`) — a **Python FastAPI** service calling `google.generativeai`. The model is hardcoded to `gemini-2.5-flash` at three sites (`ai/services/ai.py:9`, `ai/reply/service.py:16`, `ai/qualification/service.py:16`). NestJS talks to it over HTTP via `src/ai/ai.service.ts` (`/decide`, `/reply`) and `src/ai/qualification.client.ts` (`/qualify`).
- Frontend (`frontend/`) — Next.js 16 + React 19 with **only** Zustand and socket.io-client (`frontend/package.json`). No TanStack Query/Table/Virtual, no react-hook-form, no Zod, no Recharts, no error-boundary library, no Sentry. Data fetching is hand-rolled in `services/*` and `lib/api-client.ts`; realtime is a custom `contexts/SocketContext.tsx`.

**Module map (backend).** auth, user, casl, permission, contact, ingestion, qualification, enquiry, messaging, outbound (adapters + processor + DLQ + drafts + delivery-tracking), channels, webhooks, template, chat (internal staff), search, storage, ai (client), automation, websocket, events, common, database.

**Test coverage.** Effectively none — only the default Nest scaffolding (`backend/src/app.controller.spec.ts`, `backend/test/app.e2e-spec.ts`). No unit, integration, or e2e tests for any business logic.

---

## 2. Module inventory

Each entry: what it is, and its state (working / partial / stub) with the specific missing piece.

**Bootstrap** (`main.ts`, `app.module.ts`) — Nest bootstrap, `api/v1` prefix, Redis IO adapter, global JWT guard, Swagger. *RESOLVED (Block 1):* env validation (Zod, `common/config/env.schema.ts`), structured logging (nestjs-pino + nestjs-cls, `common/logging/pino.config.ts`), Sentry (`Sentry.init()` in `main.ts`), CaslGuard now global (`app.module.ts` `APP_GUARD`). *Still open:* no graceful shutdown — no `enableShutdownHooks`/SIGTERM handling anywhere in `main.ts` (R7 unresolved).

**auth** (`modules/auth/*`) — username/password login, bcrypt, JWT issue, `@Public()` bypass. *RESOLVED (Block 1):* one canonical `JWT_SECRET` in all three places (`auth.module.ts`, `jwt.strategy.ts`, `app.gateway.ts`), no fallback — `common/utils/require-env.ts` fails boot loudly instead (R3 closed).

**user** (`modules/user/*`) — user CRUD, password change, deactivate. *RESOLVED (Block 1):* `POST /users` no longer `@Public()`, gated `@CheckAbility(create:user)`; `role` still client-settable but the route now requires ADMIN to hit it at all; every route CASL-guarded; password change split into self-service (requires current password, bcrypt-verified) vs. admin-reset (requires `update:user`) (R0, R4 closed).

**casl** (`modules/casl/*`) — builds CASL abilities from DB role→permission rows, supports `manage all` and a `$userId` placeholder (`casl-ability.factory.ts`). *RESOLVED (Block 1):* `CaslGuard` registered as a second global `APP_GUARD` in `app.module.ts` — enforced app-wide now, not per-controller opt-in (R4 closed).

**permission** (`modules/permission/*`) — CRUD for permissions, role→permission maps, subject bundles. *RESOLVED (Block 1):* the dead commented-out class guard removed (redundant now that CaslGuard is global); three previously-inert `@CheckAbility` decorators (`createPermission`, `createSubjectBundle`, `createRolePermission`) uncommented and now enforced (R4 closed).

**contact** (`modules/contact/*`) — Contact + ContactChannel resolve and CRUD, primary-channel logic, encrypted nothing. `resolve()` is exact-match find-or-create. *Working for exact match;* no cross-channel identity linking or merge (a `merge-contact.dto.ts` exists with no implementation), no E.164 normalization (`contact.service.ts:449` only lowercases email).

**ingestion** (`modules/Ingestion/*`) — inbound → contact resolve → fast path (append to open enquiry) / reopen path / slow path (qualify). *PARTIAL:* `POST /ingestion/message`'s `@Public()` removed (Block 1 — R1's dead-public-route half closed; nothing legitimate ever called it over HTTP, confirmed by repo-wide grep). *Still open:* inserts still use `.create()` not `upsert` (`ingestion.service.ts:110,188,271`, R5) — explicitly deferred, user wants to discuss idempotency/replay semantics separately before touching this.

**qualification** (`modules/qualification/*`) — classifies inbound via the AI client, writes `QualificationResult` (tokens, cost, intent, confidence), emits `enquiry.qualified`. *Partial:* it is **AI-only** — the rule-engine layers modeled in the schema are never executed, so `finalLayer` is always `AI_CLASSIFIER` (R13).

**enquiry** (`modules/enquiry/*`) — inbox list, detail, FSM status changes (`enquiry.state.ts`), assign, tags, notes, stats, and the `enquiry.qualified` handler that creates/append enquiries. *Working;* the FSM is real and validated. One exception: the ingestion fast-path auto-transitions status without writing a timeline event (R14).

**messaging** (`modules/messaging/*`) — the contact-centric conversation read API for the chat UI. *Working,* CASL-guarded.

**outbound** (`modules/outbound/*`) — validate → persist → queue → send → track. Includes the adapter interface + factory, the Meta/Email adapters (the Twilio adapter was deleted — see decisions), the channel router, the window service, delivery tracking, drafts + attachments, and the DLQ. *Still open:* the window service is never called (R2 — explicitly deferred, tied to the not-yet-built template send-window fallback); the adapter interface has no capability flags (Block 2); Meta delivery receipts are still dropped (R8 — confirmed unresolved: `webhook.controller.ts`'s `handleMetaWhatsApp` now distinguishes a status receipt in its log line, but the normalizer's `canProcess()` still returns false for it, so it's ACKed and discarded, never reaching `delivery-tracking.service.ts`).

**channels** (`modules/channels/*`) — ChannelConnection CRUD, the on/off toggle, and AES-256-GCM credential encrypt/decrypt (`common/crypto/credential-cipher.ts`), with live provider validation against SendGrid and Meta. *RESOLVED (Block 1):* Meta connections now store an `appSecret` (`StoredCredentials.appSecret`, collected in the connect form, encrypted at rest) — the piece inbound-Meta HMAC needed (R1 closed). SendGrid gained a `verificationKey` field for its own signature scheme.

**webhooks** (`modules/webhooks/*`) — inbound SendGrid/Meta receive + normalize → ingest (Twilio inbound removed along with the Twilio adapter). *RESOLVED (Block 1):* `MetaWebhookGuard` verifies `X-Hub-Signature-256` via HMAC-SHA256 against the per-connection `appSecret` (timing-safe comparison, `rawBody: true` wired in `main.ts`); `SendGridSignatureGuard` verifies SendGrid's own signature scheme. Both guard the respective POST routes (R1 closed — Twilio's share of R1 is moot now that Twilio is gone). *Still open:* Meta status/delivery events still dropped (R8, see outbound entry above).

**template** (`modules/template/*`) — internal + WhatsApp templates, variable substitution, the Meta approval lifecycle. *Working,* CASL-guarded. Not yet wired into a send-window template fallback.

**chat** (`modules/chat/*`) — staff-to-staff channels and DMs, reactions, receipts, pins, membership. *Working,* with membership-checked socket rooms.

**search / storage / ai-client** — cross-contact/message search (working, CASL-guarded); S3 presigned upload/download (working); the thin HTTP client to the Python brain plus an `/ai/test` debug route (partial — no gateway or metering).

**automation** (`modules/automation/*`) — the 90-second first-touch auto-reply via a delayed BullMQ job (`ai-reply.scheduler.ts:17`). *Working,* but ungrounded with no citations (Block 7), and `npm run worker` targets an `automation.worker.ts` that does not exist (R6).

**websocket / events** — a single gateway holds all `@SubscribeMessage` handlers (`websocket/app.gateway.ts`); a single file holds all `@OnEvent` socket-emitting listeners (`events/app.event-handler.ts`). *PARTIAL:* the presence-upsert/user-lookup `.catch(() => {})` blocks now log instead of swallowing silently (`app.gateway.ts:111,119,138` — R12's swallowed-error half closed), and `handleOutboundSend`'s error ack no longer leaks a raw exception message to the client (sanitized via an `instanceof HttpException` check, same taxonomy as the HTTP filter). *Still open:* the debug `console.log` is still there, just moved (`app.gateway.ts:157-158`, was `:150-151`) — not removed (R12 not fully closed); `outbound:send` and `contact:join` still have no per-resource authorization.

**common / database** — idempotency (guard + interceptor + middleware), a response envelope, the global exception filter, the AES-GCM cipher, cursor paging, and the pg-adapter PrismaService. *PARTIAL:* the exception filter was rebuilt from scratch — typed classification (HttpException / Prisma known-errors / generic), logs every branch with a `requestId` (not just the raw-Error branch), never leaks `exception.message` to the client, registered via DI (`APP_FILTER` in `app.module.ts`, not instantiated manually in `main.ts`), and calls `Sentry.captureException` on every 5xx (R11 closed). *Still open, untouched by design:* idempotency replay still returns 409, not the stored 200 (`idempotency.guard.ts` — confirmed unchanged this session; R5 explicitly deferred, user wants to discuss idempotency semantics separately before any change here).

**Prisma models present.** Users/perms (`User`, `Permission`, `RolePermission`); identity (`Contact`, `ContactChannel`); ingestion/qualification (`InboundMessage`, `QualificationRule`, `QualificationResult`); enquiry (`Enquiry`, `ConversationMessage`, `InternalNote`, `EnquiryTimeline`, `IdempotencyKey`); outbound (`OutboundDraft`, `DraftAttachment`, `MessageAttachment`, `MessageReaction`, `ConversationMessageRead`, `OutboundDeadLetter`); channels (`ChannelConnection`); templates (`MessageTemplate`, `TemplateVariable`); internal chat (`ChatConversation`, `ChatParticipant`, `ChatMessage`, `ChatMessageReaction`, `ChatAttachment`); presence/prefs (`UserPresence`, `ContactPreference`, `ConversationRead`).

**Prisma models absent** (needed by later blocks). No pgvector or embeddings, no `AiUsage`, `CreditTransaction`, `AgentRun`, `MergeEvent`, `Quote`/`QuoteLineItem`, no catalog/knowledge tables, no analytics materialized views.

**Frontend routes.** `/auth/login`; the `(dashboard)` shell with the single socket + toasts; `/dashboard` (KPIs); `/enquiry` and `/enquiry/[id]`; `/messaging` (split-pane, contact-centric inbox); `/contacts`; `/channels`; `/chat`; `/templates` (+ `/new`, `/[id]`); `/permissions`; `/admin/dlq`; `/playground` (dev). All render, all hand-rolled — no virtualization, no error boundaries, no query cache.

---

## 3. Gap analysis against the build spec

For each build block: EXISTS / PARTIAL / MISSING with evidence.

**Block 1 — Trust & observability.** MOSTLY RESOLVED. Auth lockdown (R0), JWT unification (R3), CASL-global (R4), env validation (R9), webhook HMAC on Meta + SendGrid (R1), structured logging (pino/cls), Sentry (backend + frontend), `/health` + `/ready`, and the exception filter rework (R11) are all done and verified. **Still open:** graceful shutdown (R7 — no `enableShutdownHooks` anywhere); rate limiting and helmet (R10 — `@nestjs/throttler` never installed); the debug `console.log` in `app.gateway.ts` (R12's other half); window check still unwired (R2 — explicitly deferred, tied to the not-yet-built template send-window fallback); idempotency still replays 409 not 200 (R5 — explicitly deferred, separate conversation); Meta delivery/read receipts still dropped (R8 — confirmed unresolved). Twilio was removed from the system entirely during this block (adapter, inbound/outbound webhook routes, DTOs, normalizer, frontend UI, `twilio` npm dependency) — a scope decision made mid-block, not part of the original plan; see decisions.

**Block 2 — Channel abstraction.** PARTIAL. `ChannelAdapter` exists but is a flat `send`/`isConfigured` with **no capability flags** (`outbound/adapters/channel-adapter.interface.ts`) — exactly the lowest-common-denominator shape the spec warns against. The `ChannelConnection` registry exists; there is no conformance test suite; outbound messages carry no `channelConnectionId` (routing re-resolves "most recent", `channels.service.ts:223-238`).

**Block 3 — Gmail adapter.** MISSING. Email is SendGrid inbound-parse + outbound only; no OAuth, Pub/Sub, `historyId` watermark, threading headers, quote-stripping, or bounce handling.

**Block 4 — Identity resolution.** MISSING. `resolve()` is exact-match find-or-create, email lowercased only, no E.164 normalization, no deterministic cross-channel link, no probabilistic suggestion queue, no `MergeEvent`. The substrate (`Contact`/`ContactChannel`, unique `[channel, identifier]`) supports it.

**Block 5 — AiGateway, metering, credits.** MISSING. Direct Gemini in Python at three sites, a single hardcoded model, no router. No `AiUsage`, `CreditTransaction`, circuit breaker, semantic cache, prompt cache, batch lane, or output caps. Only per-classification token/cost columns on `QualificationResult` with a hardcoded price (`qualification.service.ts:94-98`).

**Block 6 — Knowledge layer.** MISSING. No pgvector, catalog/chunk tables, embeddings, hybrid retrieval, RRF, rerank, or eval set.

**Block 7 — AI features.** PARTIAL. The 90-second first touch exists (`automation/ai-reply.*`) but is LLM-first (not deterministic-first) and ungrounded. The classifier exists but on `gemini-2.5-flash`, not Flash-Lite, and the rule pre-filter never runs (R13). No Context Panel Q&A, no agent chat, no `AgentRun` audit.

**Block 8 — Frontend rebuild.** MISSING as a stack. Hand-rolled fetch and a custom socket context; socket updates are manual ref mutation, not `setQueryData`; no virtualization, no error boundaries, no optimistic-send rollback; reconnection loses in-flight messages (no replay, `SocketContext.tsx:140-145`).

**Block 9 — Quotations.** MISSING. No `Quote`/`QuoteLineItem`, PDF, tracked link, view events, accept/decline, or attribution. `QUOTATION_SENT` is only an `EnquiryStatus` value.

**Block 10 — Analytics.** MISSING/PARTIAL. `enquiry.service.getStats()` does **live aggregation** (`groupBy` + `$queryRaw`, `enquiry.service.ts:825`) — the opposite of the required materialized views. No response-time percentiles, funnel, revenue, AI-acceptance, or cost-per-conversation.

**Block 11 — Production readiness.** MISSING. No load test, migration rehearsal, backup drill, runbook, alerting, or documented zero-downtime deploy. Only `docker-compose.yml` and a `cloudflared` dependency exist.

**Roll-up.** Blocks 1–2 are partly in place and mostly need correctness and shaping. Blocks 3–7, 9–11 are greenfield. Block 8 is a stack rebuild. The data substrate (`Contact`/`ContactChannel`, `Enquiry`/`ConversationMessage`, `ChannelConnection`, `EnquiryTimeline`) is solid and will carry the new work without redesign.

---

## 4. Risk register

Ranked by blast radius. Each: what breaks · who notices · severity · file:line · rough fix size (S ≈ under half a day, M ≈ half to two days, L ≈ more than two days).

**R0 — Anyone on the internet can create an ADMIN account. CRITICAL. S. ✅ RESOLVED.**
`POST /users` is `@Public()` (`user.controller.ts:29-33`) and `CreateUserDto.role` is client-settable (`dto/create-user.dto.ts:21-22`). An attacker POSTs `{userName, password, role: "ADMIN"}` and logs in through the normal flow. Nobody notices until data is taken or destroyed — full compromise. Fix: remove `@Public()`, drop `role` from the public path, guard with CASL. It is the first thing that ships.
*Fixed in Block 1:* `@Public()` removed from `createUser`; route gated `@CheckAbility({action:'create', subject:'user'})`; all other `UserController` routes gated too (`read`/`update`/`delete`). `role` is still accepted in the DTO, but the route now requires an authenticated ADMIN to reach it at all, closing the actual exploit path.

**R1 — No signature verification on inbound webhooks (billing DoS + fake enquiries). CRITICAL. M. ✅ RESOLVED.**
Inbound handlers verify nothing — Twilio (`webhook.controller.ts:42`), SendGrid (`:66`), Meta (`:116`); `webhook.service.ts` is empty; `POST /ingestion/message` is a second public route (`ingestion.controller.ts:18`). Each accepted message can trigger a Gemini call (qualification + auto-reply), so this is attacker-controlled LLM spend plus fabricated leads and auto-replies to arbitrary numbers. The fix is blocked on two things: `main.ts:14` parses the body with no raw-byte capture (Meta HMAC needs the raw bytes), and the Meta connection stores no `appSecret` (`channels.service.ts:126`). The client notices via the monthly AI bill and Meta quality flags. Fix: raw-body middleware on webhook routes, `X-Hub-Signature-256` (Meta), `X-Twilio-Signature` (inbound — the pattern already exists at `outbound.controller.ts:153`), and a SendGrid signed key.
*Fixed in Block 1:* `main.ts` now boots with `{ rawBody: true }`. `MetaWebhookGuard` verifies `X-Hub-Signature-256` (HMAC-SHA256, timing-safe compare) against a per-connection `appSecret` now stored encrypted on the Meta `ChannelConnection`. `SendGridSignatureGuard` verifies SendGrid's signature scheme with a stored `verificationKey`. `POST /ingestion/message` had its `@Public()` removed (confirmed dead — nothing calls it over HTTP). Twilio's share of this risk is moot: the Twilio adapter, inbound webhook route, and DTOs were deleted entirely (see decisions) rather than secured.

**R2 — 24-hour WhatsApp window never enforced on send. HIGH. M. ⬜ OPEN — deferred.**
`WhatsAppWindowService.isWindowOpen()` (`whatsapp-window.service.ts:14`) has zero callers. The send path (`outbound-send.service.ts`, `outbound.processor.ts`, `channel-router.service.ts`) never gates; there is no template fallback. Meta error 131047 is only mapped for display (`meta-whatsapp.adapter.ts:106`), never prevented. Repeated violations degrade the Meta quality rating and restrict the number. Fix: call `isWindowOpen(contactId)` in the send path, reject free-form with a typed error and a `contactId` log, fall back to an approved template.
*Status unchanged.* Explicitly deferred — tied to the template module's send-window fallback, which isn't built yet. Order between the two doesn't matter; do them together later.

**R3 — JWT secret name mismatch plus a `dev-secret` fallback (token forgery). CRITICAL. S. ✅ RESOLVED.**
Signing uses `JWT_SECRET` (`auth/auth.module.ts:12`); verification uses `JWT_SECERET` — misspelled — in both `auth/strategies/jwt.strategy.ts:12` and `websocket/app.gateway.ts:74`, each `|| 'dev-secret'`. If production sets only the correctly-spelled `JWT_SECRET`, verification silently uses the public `dev-secret` and anyone can forge any token and role. If it sets only the typo, signing uses `dev-secret`. Either way a predictable key is in play, and forged ADMIN tokens are indistinguishable from real ones. Fix: one canonical `JWT_SECRET` everywhere, remove the fallback, fail boot if unset. Do it first.
*Fixed in Block 1:* one `JWT_SECRET` read via `common/utils/require-env.ts` in all three places, no fallback — throws a clear error at boot if unset. Also surfaced and fixed a related latent bug: `.env` was never actually loaded before `AuthModule`'s static `JwtModule.register()` ran (no `dotenv/config` import in `main.ts` before this), so the fix only became safe to ship after adding `import 'dotenv/config'` as the first line of `main.ts`.

**R4 — CASL is not global; PermissionController and UserController are unguarded. HIGH. M. ✅ RESOLVED.**
Only `JwtAuthGuard` is registered globally (`app.module.ts:82-85`). `CaslGuard` is applied per-controller, but `permission.controller.ts:24` has it commented out with no global fallback, so its `@CheckAbility` decorators are inert — any authenticated user reads and writes permissions and role maps. `UserController` has no CASL at all, so any authenticated SALES or OPS user can list users, deactivate them, and change any user's password (`PATCH /users/:id/password` takes only a `newPassword`, with no current-password check, `create-user.dto.ts:43-47`) — i.e. reset the ADMIN's password and take over. The `ai` and `ingestion` controllers also carry no CASL. Fix: register `CaslGuard` globally (or restore it per-controller consistently), add `@CheckAbility` to user/permission routes, require the current password to change it.
*Fixed in Block 1:* `CaslGuard` registered as a second global `APP_GUARD` (after `JwtAuthGuard`) in `app.module.ts` — verified safe for `@Public()`/undecorated routes since `CaslGuard.canActivate()` returns `true` before checking `request.user` when no `@CheckAbility` metadata is present. The now-redundant per-controller `@UseGuards(CaslGuard)` removed from 11 controllers. Password change split: self-service requires the current password (bcrypt-verified); admin-reset requires `update:user` and skips it. Also found and closed a related hole not in the original list: `PATCH /enquiry/qualfiy` was `@Public()` and called `handleQualified()` directly, letting anyone fabricate an enquiry — removed `@Public()`, added `@CheckAbility(create:enquiry)`.

**R5 — Idempotent webhook replay returns 409, not 200 (retry storms). HIGH. S. ⬜ OPEN — deferred.**
A completed idempotency key throws `ConflictException` → HTTP 409 (`common/Idempotency/idempotency.guard.ts:48-49`). Meta and Twilio treat any non-2xx as failure and retry indefinitely, eventually disabling the endpoint. Separately, on a key miss, ingestion `.create()` on a duplicate `externalId` throws P2002 → 500 (`ingestion.service.ts:110,188,271`). Fix: on a completed key replay the stored 200 response; switch ingestion inserts to `upsert` on `[channel, externalId]`. Worth noting the dedup mechanism itself is real — the `IdempotencyMiddleware` (`app.module.ts:90`) synthesizes the key from the Twilio `MessageSid`, Meta `wamid`, or email `Message-ID` — the bug is only the reply semantics.
*Status unchanged, confirmed by re-reading `idempotency.guard.ts` this session.* Explicitly deferred at the user's request — idempotency/replay semantics to be discussed separately before any change here. No change made to this file or to the ingestion `.create()` calls.

**R6 — The documented separate worker does not exist; workers run in-process. HIGH. M. ⬜ OPEN — untouched.**
`npm run worker` targets `src/modules/automation/automation.worker.ts` (`backend/package.json:21`), but no `*.worker.ts` file exists. Every `@Processor` (`outbound.processor.ts`, `qualification.processor.ts`, `ai-reply.processor.ts`) is registered in Nest modules and runs in the API process, contradicting the "separate process, always run alongside" rule. API latency and job processing now share one event loop and one deploy lifecycle. Fix: decide the topology (see the decisions section), then either build the worker entrypoint or delete the script and the rule.
*Not part of Block 1's ordered commits; still an open decision.*

**R7 — No graceful shutdown (deploys drop in-flight work). MEDIUM. S. ⬜ OPEN.**
No `enableShutdownHooks`, `OnApplicationShutdown`, or SIGTERM handling anywhere (`main.ts`). A redeploy kills BullMQ jobs mid-flight and drops sockets without draining — a lead whose auto-reply was mid-send gets nothing; an outbound message is stuck `PENDING`. Fix: `app.enableShutdownHooks()`, close BullMQ workers and Socket.IO on SIGTERM.
*Confirmed unresolved — grepped `main.ts`/`app.module.ts`/`outbound.processor.ts` for `enableShutdownHooks`/`OnApplicationShutdown`, zero hits. The rest of the observability item (pino/cls, exception filter, Sentry, `/health`+`/ready`) shipped; this one piece didn't.*

**R8 — Meta delivery and read receipts are never recorded. MEDIUM. M. ⬜ OPEN.**
`DeliveryTrackingService` (`outbound/delivery/delivery-tracking.service.ts`) handles Twilio and SendGrid only; Meta status events reach `handleMetaWhatsApp` and are dropped as "skipped" (`webhook.controller.ts:134-136`). Meta-sent messages stay `SENT` forever — no DELIVERED or READ ticks. Fix: parse `statuses[]` in the Meta normalizer and route to `updateDeliveryStatusByExternalId`.
*Confirmed unresolved this session, despite adjacent Meta webhook work landing (R1's HMAC fix touches the same handler).* `handleMetaWhatsApp` now logs `📋 [Delivery Status Receipt]` to distinguish a status payload from a real message — but the normalizer's `canProcess()` still returns `false` for it, so it's ACKed and discarded, same as before. Better logging, not a fix.

**R9 — No boot-time env validation. MEDIUM. S. ✅ RESOLVED.**
`ConfigModule.forRoot({ isGlobal: true })` (`app.module.ts:33`) has no schema. A typo in `DATABASE_URL`, `REDIS_HOST`, `AI_SERVICE_URL`, or a secret fails at first use, not at boot; secrets silently fall back (this is what makes R3 dangerous). Fix: Zod validation over the full env surface, fail fast.
*Fixed in Block 1:* `common/config/env.schema.ts` — a Zod schema over the full env surface, wired via `ConfigModule.forRoot({validate: validateEnv})`. Fails boot with every problem listed at once (not just the first), and Zod's `.default()`/coercion means `ConfigService.get('REDIS_PORT')` now actually returns a real `number`, not a string with a lying type annotation. `SENTRY_DSN` deliberately not added to this schema — user's call, adding it to `.env` directly.

**R10 — No rate limiting or helmet on public routes. MEDIUM. S. ⬜ OPEN.**
`@nestjs/throttler` is not installed (`package.json`); the public webhooks, `/ingestion/message`, `/users`, and `/auth/login` are unthrottled, which amplifies R0 and R1. Fix: throttler on public routes, helmet headers.
*Confirmed unresolved — neither `throttler` nor `helmet` appear in `package.json`. Not started.*

**R11 — Exception filter leaks internals and under-logs. MEDIUM. S. ✅ RESOLVED.**
`common/filters/global-exception.filter.ts` returns the raw `exception.message` for unknown errors (`:61`) — DB and internal detail to clients — logs nothing on the HttpException and Prisma branches, carries no requestId, and is instantiated outside DI (`main.ts:43`). Fix: a typed taxonomy, log every 5xx with context, a generic message to the client. Folds into the Block-1 logging work.
*Fixed in Block 1:* rebuilt with a typed three-branch classification (`classifyHttpException` / `classifyPrismaException` — using `instanceof Prisma.PrismaClientKnownRequestError`, not the old fragile `constructor.name` string check — / `classifyGenericError`), every branch logs with a `requestId` (previously only the raw-Error branch logged anything), the client never sees `exception.message`/stack for unknown errors, registered via `APP_FILTER` DI (not `new GlobalExceptionFilter()` in `main.ts`) so it can inject `ClsService` for the requestId, and calls `Sentry.captureException` on every 5xx branch only (confirmed: no 4xx branch calls it). A follow-up audit pass across all modules found and fixed 3 bare-`Error`-instead-of-HttpException throws in `chat.service.ts` and a `BadRequestException`-should-be-`ForbiddenException` mismatch in 2 outbound files, now consistent with this filter's taxonomy.

**R12 — Leftover debug and swallowed async rejections. LOW. S. 🟡 PARTIAL.**
A `console.log` in `websocket/app.gateway.ts:150-151`, and several fire-and-forget `.catch(() => {})` (gateway presence at `:110,116`, event-handler helpers) where failures vanish. Fix: remove the debug, log the swallowed errors.
*Swallowed catches fixed in Block 1:* 5 sites now log instead of silently swallowing — `app.gateway.ts` presence/user-lookup catches (`:111,119,138`), `draft.service.ts`'s orphaned-file delete, `qualification.service.ts`'s contact-name update. *Debug console.log still open:* confirmed still present, just at new line numbers (`app.gateway.ts:157-158` — the file changed shape enough that the original `:150-151` reference is stale) — not removed.

**R13 — Rule-engine layers modeled but never executed. LOW/MEDIUM. M. ⬜ OPEN — untouched.**
`qualify()` (`qualification.service.ts:62`) calls the AI classifier unconditionally, so `finalLayer` is always `AI_CLASSIFIER`. The entire `QualificationRule` / `RuleType` / `QualificationLayer` schema (blacklist, whitelist, short-text, duplicate, domain) is dead. Every message pays for an LLM call the deterministic layer was meant to avoid — directly counter to the 60%→80% no-LLM target. Fix: implement the rule pre-filter before the AI call, or formally defer and document it.
*Not part of Block 1; formally deferred to Block 5 per the existing decision below.*

**R14 — Status changes without a timeline event (audit gap). LOW. S. ⬜ OPEN — untouched.**
The ingestion fast-path auto-transitions (`STALE→OPEN`, `AWAITING_CUSTOMER→IN_PROGRESS`, and so on) update `status` with no `EnquiryTimeline` row (`ingestion.service.ts:141-148`), violating the "timeline alongside every status change" rule. The revenue-traceability moat has holes. Fix: write a timeline event in `appendToExistingEnquiry`.
*Not part of Block 1's ordered commits; not touched this session.*

**Schema and index flags** (for the Block-1 migration to absorb). `ConversationMessage.externalId` is indexed but not unique (`schema.prisma:520`), yet delivery callbacks match on it (`outbound.service.ts:180`) — a provider replay can double-apply status. `InboundMessage.externalId` is nullable under `@@unique([channel, externalId])` (`:186,213`), and Postgres allows many NULLs, so a provider that omits the ID produces duplicates. Foreign keys without a dedicated index: `ConversationMessage.sentByUserId` and `.replyToId`, `ChatMessage.senderId` and `.parentMessageId`, `MessageReaction.userId` — fine at current volume, flag before the message table grows. Every new Block 4/5/6/9 table (`MergeEvent`, `AiUsage`, `CreditTransaction`, `AgentRun`, embeddings, `Quote*`) needs backfill planning against existing `Contact`/`Enquiry`/`ConversationMessage` rows.

---

## 5. Execution plan

Blocks are reviewable commit boundaries. The order is refined against the audit (see the re-sequencing decisions below). Block numbers are fixed labels for content, not the build order — the actual execution order is:

**Block 1 → Block 2 → Block 3 → Block 4 → Block 8 → Block 5 → Block 6 → Block 7 → Block 9 → Block 10 → Block 11.**

Block 8 (frontend rebuild — the channel-wise inbox) moved ahead of Block 5 (AiGateway) by directive: the channel-routed inbox is the surface every AI feature drafts into, and it's also the thing daily use depends on — it ships before any AI-layer work starts, not just "in parallel with it."

**Hard dependencies.** Block 1 gates everything. Block 2 gates Block 3 (and gates Block 8's per-channel routes, since the frontend needs the capability flags to render channel-specific affordances correctly). Block 5 gates Block 6 gates Block 7. Block 4 ships its data layer independently but gets its strongest join key from Block 9's tracked link. Block 10 needs Block 9. Block 11 is last.

**Parallelizable.** Once Block 1 lands, the Block 4 data layer can proceed alongside Block 2/3/8 — it's invisible in the UI and touches no AI code. Block 5 does not start until Block 8 ships.

### Block 1 — Trust & observability
Make the system authenticated, verifiable, and debuggable before any new surface is added. Nothing ships first — every later block adds attack surface and spend to a system that today accepts unauthenticated admin creation (R0), unauthenticated webhooks (R1), and forgeable tokens (R3).

**Status: mostly done.** Six of eight ordered commits are complete and verified; two were explicitly deferred by the user, and observability/hardening each shipped with one piece left open.

Ordered commits, each independently reviewable:
- ✅ **Auth lockdown** — remove `@Public()` from `POST /users`, drop client-settable `role`, add `@CheckAbility(create user)`, require the current password on change, register `CaslGuard` globally (or restore consistently) and add CASL to user/permission/ai/ingestion. (R0, R4) — *done; also closed an unplanned `PATCH /enquiry/qualfiy` hole found during the sweep.*
- ✅ **JWT secret unification** — one `JWT_SECRET`, remove the `dev-secret` fallback in the strategy and the gateway. (R3) — *done; also fixed a latent dotenv-load-ordering bug this surfaced.*
- ✅ **Env validation** — Zod over the full env surface, fail boot on missing or malformed. (R9) — *done.*
- ✅ **Webhook trust** — raw-body capture on webhook routes; `X-Hub-Signature-256`, SendGrid signed key; store the Meta `appSecret`. (R1) — *done for Meta + SendGrid. `X-Twilio-Signature` moot: Twilio was removed from the system entirely rather than secured (see decisions).*
- ⬜ **Idempotency semantics** — replay the stored 200 on a completed key; ingestion `.create()` → `upsert`. (R5) — *deferred at the user's explicit request, untouched. To be discussed separately.*
- ⬜ **Window enforcement** — call `isWindowOpen()` in the send path, typed rejection plus `contactId` log, template fallback hook. (R2) — *deferred, tied to the not-yet-built template send-window fallback.*
- 🟡 **Observability** — nestjs-pino + nestjs-cls (requestId, contactId, etc.), rework the exception filter (typed taxonomy, log every 5xx, no leak), Sentry (backend + frontend), `/health` and `/ready` (DB, Redis, adapter), graceful shutdown draining BullMQ and sockets. (R7, R11) — *pino/cls, exception filter, Sentry, and `/health`+`/ready` all done and verified live. Graceful shutdown not started — R7 still open.*
- 🟡 **Hardening** — `@nestjs/throttler` and helmet on public routes; remove debug and swallowed catches. (R10, R12) — *swallowed `.catch(() => {})` blocks now log (5 sites). Rate limiting and helmet not started — R10 still open. The debug `console.log` in `app.gateway.ts` was not removed, just shifted lines.*

Data-model delta: the Meta connection's encrypted blob gains `appSecret` (no column change); optionally make `ConversationMessage.externalId` unique and enforce `InboundMessage.externalId` non-null per channel. Rollback: revert the migration; ship signature enforcement in log-only mode for one deploy before hard-fail.

Acceptance criteria: an unauthenticated `POST /users {role:ADMIN}` returns 401/403, and an authenticated non-admin returns 403. A Meta POST with a wrong or absent signature returns 401 with no enquiry created and no Gemini call; a correct signature returns 200. Replaying the same `wamid` returns 200 with the original body and exactly one `InboundMessage`. A free-form WhatsApp send with the window closed is rejected with a typed error, logs a line carrying `contactId`, and makes no Graph API call. Boot with a missing required env var exits non-zero and names the offending key. SIGTERM lets an in-flight BullMQ job finish, then exits, with no `PENDING` orphan.

Size: L (roughly four to six days). New concepts: HMAC over raw request bytes; nestjs-cls async-local context; BullMQ worker drain; reserve-before-fallback window logic.

### Block 2 — Channel abstraction
A capability-flagged `ChannelAdapter` plus connection-scoped routing, with no behaviour change, so Block 3 never touches the messaging core. Add a `capabilities` object (sending window, template-gated, subject, threading, rich attachments, read receipts, typing) to the interface and the adapters, a conformance test suite every adapter must pass, and a `channelConnectionId` on `ConversationMessage` (nullable, backfill null). Acceptance: each adapter declares its flags, the router uses `channelConnectionId` when present, the conformance suite is green for Meta/Email (Twilio removed during Block 1 — see decisions, one fewer adapter to retrofit), and outbound results are unchanged. Size: M.

### Block 3 — Gmail adapter
First-class Gmail via OAuth (connect, refresh, revoke) and Pub/Sub push with a `historyId` watermark and gap recovery, threading via `threadId` plus `Message-ID`/`In-Reply-To`/`References`, quoted-chain stripping before persist and before embedding, attachments and HTML-to-text, per-account send routing, and bounce/complaint handling. Depends on the Block 2 flags. Size: L. New concepts: Pub/Sub `historyId` watermarking; RFC-2822 threading headers.

### Block 4 — Identity resolution (data layer)
Deterministic auto-link at confidence 1.0 (normalized E.164 phone, lowercased email, platform user ID), probabilistic suggestions at 0.6–0.95 to an approval queue (never auto-merge below threshold), and a `MergeEvent` table where every merge is reversible with both original contact IDs retained. Invisible in the UI; powers the Context Panel. The strongest join key — the same tracked quote link opened from two channels — arrives with Block 9, so build the deterministic and probabilistic paths now and wire the quote-link resolver then. Data-model delta: `MergeEvent`, a suggestion/approval table, and an E.164 backfill on `ContactChannel`. Size: L.

### Block 5 — AiGateway, metering, credits
A single AI choke point that owns model routing (classification/qualification to Flash-Lite, drafting to Flash, escalation/quote reasoning to Pro — task-type-based, configurable, logged), a semantic answer cache, prompt caching above a per-client volume threshold, a nightly batch lane at half cost, per-task output caps, an `AiUsage` row per call, and a `CreditTransaction` append-only ledger with a derived balance and reserve→commit→release. A per-client circuit breaker degrades to draft-for-approval rather than failing loud. Build it before AI features multiply the call sites — there are only about three Python sites and the Nest client today. Acceptance: every Gemini call flows through the gateway; the balance never goes negative under concurrent load; cost per conversation is queryable. Size: L. New concepts: reserve/commit/release ledger; semantic answer cache; prompt-cache economics.

### Block 6 — Knowledge layer
Versioned catalog ingestion, one chunk per SKU or service (do not naive-split at 512 tokens), price/category/SKU/availability as metadata columns rather than embedded prose, re-embed only on content-hash change, and hybrid retrieval — pgvector plus Postgres `tsvector`, fused with Reciprocal Rank Fusion, reranked, assembled to a token budget — with a small golden-question eval fixture. Needs the Block 5 gateway for embedding calls and metering. Size: L. New concepts: RRF; hybrid retrieval; token-budgeted assembly.

### Block 7 — AI features
Grounded draft-for-approval replies with mandatory citations (no factual claim without a chunk ID, or it escalates), a deterministic-first 90-second first touch (rebuilding today's ungrounded auto-reply and implementing the dead rule pre-filter, R13), a Flash-Lite qualification classifier, the Context Panel cross-channel Q&A scoped to `contactId`, an operator-facing agent chat, and an `AgentRun` audit for every decision (inputs, retrieved chunk IDs, model, prompt version, output, cost, latency, and human accept/reject/edit). Needs Blocks 5 and 6. Size: L.

### Block 8 — Frontend rebuild (channel-wise inbox) — moved ahead of the AI layer
Channel routes per the spec (`/inbox/whatsapp`, `/inbox/gmail`, separate lists/filters/unread counts — no unified inbox, no channel toggle inside a thread), on TanStack Query with stable, factored keys; socket events applied as surgical `setQueryData` patches (never `invalidateQueries` on a message event); virtualized thread and message lists; optimistic send with rollback; per-route error boundaries with a real recovery path; react-hook-form + Zod with schemas shared with the backend DTOs; and the Context Panel shell (identities/history/commercial-state sections — wired to real data as Blocks 4/6/9 land). Built after Block 2 (needs the capability flags to render per-channel affordances) and before Block 5 — every AI feature (draft replies, Context Panel Q&A, agent chat) drafts *into* this inbox, so the inbox has to exist and be stable first, and it's also the surface staff use every day, independent of AI. The four real killers are unstable query keys, invalidate-on-socket, missing virtualization, and no optimistic send — fix those, then profile, then memoize only what the profiler names. No hand-memoization on spec. Size: L.

### Block 9 — Quotations & the money loop
Versioned `Quote` and `QuoteLineItem` (never mutate a sent quote — revisions version), branded PDF generation, a tracked send link with view events (first view, count, duration, device), accept/decline capture, and attribution linking every quote to its conversation and enquiry. The view events feed both identity resolution (Block 4) and analytics (Block 10). This is the moat. Size: L.

### Block 10 — Analytics
Materialized views with a refresh cron — never live aggregation over the message table, which is what `getStats()` does today. Response time p50/p90/p99 (the proof of the 90-second claim), funnel conversion by stage, revenue per channel/source/agent, AI draft acceptance rate and edit distance, and cost per conversation and per closed deal. Needs Block 9 revenue, Block 5 cost, and Block 7 acceptance data. Size: M/L.

### Block 11 — Production readiness
A load test against realistic volume, a migration rehearsal on a production-shaped dataset, a timed backup-and-restore drill, a runbook, alerting on the things that matter (ingestion lag, 90-second SLA breach, queue depth, AI spend anomaly, adapter auth expiry), and a documented zero-downtime deploy with rollback. Last, because it validates everything under real volume. Size: L.

---

## 6. Decisions

Decisions the spec does not already lock, plus two challenges to the ordering, each with evidence.

**Webhook verification needs raw-body capture.** Meta signs the exact raw request bytes, but `main.ts:14` parses the body globally before any handler runs, and the Meta `appSecret` is not stored. Choice: scope raw capture to the webhook routes only (keep parsed bodies everywhere else), and store `appSecret` in the Meta connection's encrypted blob. Ship in log-only mode for one deploy before hard-failing.

**Idempotent replay returns the stored response, not 409.** The guard throws 409 on a completed key; Meta and Twilio retry on any non-2xx. Choice: for webhook routes, replay the persisted 200 body (the interceptor already stores it at `idempotency.interceptor.ts:25-31`); keep 409 only for genuine client double-submits. Ingestion moves to `upsert`.

**Env validation uses Zod.** The spec already standardizes on Zod for shared FE/BE contracts, so use one validation vocabulary across env, DTOs, and the frontend. Fail boot with the offending key named.

**Logging is nestjs-pino + nestjs-cls.** This is locked by the spec — recorded here for the package justification and the migration note: every `this.logger.log(\`...${x}\`)` becomes structured fields, and Sentry hooks into the same pipeline.

**CaslGuard becomes global-by-default.** Today it is per-controller and two controllers slipped it. Choice: register it as a second global guard after JWT, so adding a controller can never silently ship unguarded; routes with no `@CheckAbility` still pass (the guard returns true when there is no ability metadata), and genuinely public routes already carry `@Public()`. Audit every existing route once for an intended-permissive endpoint that would newly need a decorator.

**Re-sequence: auth lockdown is commit #1 of Block 1.** Evidence: R0 (public admin creation) and R3 (the secret mismatch) are internet-exploitable today and both fixes are S; HMAC (R1) is more valuable but larger and needs schema and config work. So land the auth lockdown and JWT unification first (hours), then env validation, then webhook trust, then the window, then observability. If the instance is not yet internet-exposed, R1 can precede R0.

**Re-sequence: frontend channel-wise inbox (Block 8) moves ahead of the AI layer (Blocks 5–7) — user directive.** Every AI feature in Blocks 5–7 (draft-for-approval replies, Context Panel Q&A, the agent chat) renders into the inbox UI; building the AI layer against the current hand-rolled frontend means re-wiring those features once Block 8 eventually replaces it. The inbox is also the thing staff use every single day, independent of whether AI ships — it doesn't need the AI layer to be valuable on its own. Block 8 still needs Block 2's capability flags (a WhatsApp thread and a Gmail thread render different affordances), so the order is Block 1 → 2 → 3 → 4 → **8** → 5 → 6 → 7 → 9 → 10 → 11, not Block 8 done "in parallel" as originally scoped.

**Fold idempotency-replay (R5) and Meta receipts (R8) into Block 1.** Evidence: R5 lives in the same idempotency and ingestion files Block 1 already edits for R1, and a 409 retry storm actively harms the Meta delivery health the window work is trying to protect. R8 is ingestion-path correctness in the same normalizer Block 1 touches for signatures. Both ride in Block 1 rather than waiting for Blocks 2–3. If Block 1 is already at review-size ceiling, R8 can defer to Block 3, where receipt handling is revisited anyway.

**Twilio removed from the system entirely (user directive, made during Block 1).** The WhatsApp channel was originally dual-provider — Twilio (env-var-configured, no `ChannelConnection` support, effectively unfinished — `ChannelProvider.TWILIO_WHATSAPP` was already commented `// enum seat reserved, not wired yet`) and Meta Cloud API (the "real" connection-based provider). Rather than secure Twilio's inbound webhook as R1 originally scoped, the user chose to delete it outright: the `WhatsAppAdapter` (Twilio) file, its outbound delivery-webhook route, its inbound normalizer/DTO, the `twilio` npm dependency, and every "WhatsApp (Twilio)" affordance in the frontend Channels UI (which was a non-functional client-side-only demo — its "Connect" flow never called the backend, just faked a success state). The `TWILIO_WHATSAPP` Prisma enum value was deliberately left in place (inert, already marked reserved-not-wired — dropping it needs a migration and nothing depends on it existing). Net effect: WhatsApp is now Meta-only, and R1's Twilio-signature half is moot rather than fixed. This narrows Block 2's channel-abstraction work slightly (one fewer adapter to retrofit capability flags onto) and should be reflected in any future single-provider assumptions in Block 2/3 planning.

**Worker process topology (open decision).** `npm run worker` targets a non-existent file; all processors run in-process; the docs claim a mandatory separate worker. The lean recommendation is to build a real separate worker entrypoint — a Nest standalone context booting only the processor modules, with its own pg-adapter Prisma — because the single-tenant model still deploys and restarts, R7 shows in-process workers make every deploy a job-dropper, and a separate worker isolates job processing from API latency and is cheap to build now but expensive to retrofit after AI features multiply job volume. The alternative is to formally adopt in-process workers and delete the script and the rule. This one is worth an explicit call from you.

**Deterministic-first qualification (implement the dead rule engine).** The `QualificationRule` schema is fully modeled but never executed. The recommendation is to defer the full rule engine to Block 5, where the semantic answer cache delivers the biggest no-LLM win, rather than spending effort ahead of the metering that proves its value — but keep the schema, do not delete it, and record this as an explicit deferral. If pre-Block-5 AI spend is already painful, pull a minimal blacklist and duplicate pre-filter forward into Block 1, since both are cheap, deterministic, and reduce R1's blast radius.

**On the locked decisions in the spec.** Nothing in the locked architecture is impossible or actively harmful given the code. The channel-first UI, the Context Panel, capability-flagged adapters, the single AI choke point, the TanStack/Zustand split, pino/cls, hybrid retrieval, the grounding contract, and quotations-as-product are all consistent with the current substrate. The only friction points are execution gaps, captured above as risks — not architecture disagreements.
