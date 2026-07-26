# EnquiryHub — Production Build Spec

**Read this entire file before writing a single line of code.**

---

## 0. Who you are on this project

You are the senior systems engineer on EnquiryHub. I am the founder and the only other engineer. I review every line you write and I will ask you to explain your reasoning. I am not vibe coding this. Polish can be delegated; architecture cannot.

Your job in order of priority:
1. Tell me the truth about the current state of this codebase, with file paths and line numbers.
2. Produce a sequenced plan I can execute against a deadline.
3. Implement it one reviewable commit boundary at a time, stopping between each.

You do not get to skip step 1 or 2.

---

## 1. Product context

EnquiryHub is an AI-powered enquiry and lead management system for real-estate agencies and other high-enquiry-volume businesses.

**Deployment model:** single-tenant, done-for-you. One dedicated instance per client (SAP-style), not shared multi-tenant SaaS. Design for a handful of clients each with real volume, not for a million signups. This means: prefer operational simplicity and per-instance clarity over horizontal-scale abstractions. Do not build sharding, tenant isolation middleware, or org-level routing that the deployment model does not require.

**The promise the product sells:**
- Every inbound enquiry gets a first touch within 90 seconds.
- Follow-ups happen on their own and don't get dropped.
- Revenue is traceable back to the exact conversation that produced it.

That third one is the moat. Everything else is table stakes.

**Stack (already chosen — do not propose replacements):**
- Backend: NestJS 11, Prisma 7, PostgreSQL + pgvector, BullMQ + Redis, Socket.IO
- AI: Gemini (Flash-Lite / Flash / Pro tiers), Python FastAPI microservice for AI endpoints
- Channels: Meta WhatsApp Cloud API (primary), Twilio (fallback connector), Gmail API, SendGrid (transactional)
- Frontend: Next.js 16, CASL for permissions (ADMIN, MANAGER, SALES, OPS)

---

## 2. Locked architectural decisions

These are decided. Do not re-litigate them in your plan. If the audit turns up hard evidence that one of them is impossible or actively harmful, raise it in `04-decisions.md` with the evidence — file paths, measurements, or a concrete failure mode. Not a preference.

### 2.1 Channel-first routing, contact-first data

The UI is organised by channel. `/inbox/whatsapp` and `/inbox/gmail` are separate pages with separate lists, separate filters, separate unread counts. A Gmail message appears in the Gmail inbox. It does not get folded into a unified list.

The **data layer keeps `Contact` + `ContactChannel`.** The identity link survives; it just stops driving navigation. This is not a compromise — it is what makes 2.2 possible.

Do not build a unified inbox view. Do not build a channel toggle inside a thread.

### 2.2 The Context Panel

A right-hand panel available on any open thread. Three sections:
- **Linked identities** — other channels where this contact exists, with confidence.
- **Ask across history** — free-text question, RAG scoped to `contactId`, answers span every channel. "What did she ask about on WhatsApp?" returns a cited answer.
- **Commercial state** — latest quote, its status, last activity.

This panel is the demo moment. Treat its latency and citation quality as product-critical, not nice-to-have.

### 2.3 Channel adapters

Gmail and WhatsApp are the only adapters being built now. Instagram and LinkedIn come later.

Every channel goes through a `ChannelAdapter` interface with **capability flags** — because channels are not symmetric:

| Capability | WhatsApp | Gmail |
|---|---|---|
| Sending window constraint | yes (24h) | no |
| Template-gated outside window | yes | no |
| Subject line | no | yes |
| Threading model | conversation id | `threadId` + `References` |
| Rich attachments | limited | yes |
| Read receipts | yes | no |
| Typing indicator | yes | no |

The abstraction must not flatten these into a lowest-common-denominator interface. Adding Instagram later should cost a day, and should not require touching the messaging core. Write a **conformance test suite** that any new adapter must pass.

### 2.4 One AI choke point

Nothing calls Gemini directly. Ever. Every AI call routes through a single `AiGateway` service that owns model routing, caching, metering, credit accounting, and circuit breaking. See section 5.

### 2.5 Frontend state

- **Server state → TanStack Query v5.** The inbox is 95% server state.
- **Client state → Zustand.** Composer drafts, filters, selected thread, panel open/closed. Should be under ~100 lines total.
- **Realtime → Socket.IO events patch the cache via `queryClient.setQueryData`.** Never `invalidateQueries` on a message event. That is a full inbox refetch per inbound message.
- **No Redux. No RTK. No tRPC. No GraphQL. No Jotai/Recoil.**
- Lists → TanStack Virtual. Forms → react-hook-form + Zod. Tables → TanStack Table. Charts → Recharts. Errors → react-error-boundary + Sentry.
- Zod schemas are shared between Nest DTOs and the frontend. One source of truth per contract.

### 2.6 Logging and observability

`nestjs-pino` + `nestjs-cls`. Every log line automatically carries `requestId`, and where applicable `contactId`, `channelConnectionId`, `agentRunId`. Structured JSON, no string interpolation of context. Pino over Winston for throughput.

### 2.7 Retrieval

Hybrid, not pure vector. pgvector cosine **plus** Postgres `tsvector` full-text, fused with Reciprocal Rank Fusion. Pure vector search fails on exact lookups — "price of SKU-4471" gets a shrug from cosine similarity. Rerank, then fill to a token budget rather than a fixed top-k.

### 2.8 Grounding contract

Every AI-drafted reply carries chunk IDs for every factual claim. If a price or spec is not present in retrieved context, the model must not state it — it escalates to a human instead. Citations persist in `AgentRun`. That table is the answer to "why did it say that," and it is what separates this from an LLM wrapper.

### 2.9 Quotations are the product

Enquiry → conversation → quote → viewed → accepted → revenue attributed to the conversation. That closed loop is the reason a client pays monthly. Build it as a first-class module, not a PDF generator bolted on.

---

## 3. PHASE 0 — AUDIT. No production code.

Your first deliverable is documentation, not code. You are read-only in this phase except for creating files under `docs/audit/`.

**Prohibited in Phase 0:** refactors, "while I was in there" fixes, dependency changes, schema changes, formatting passes. Report problems. Do not fix them. If something is broken, it goes in the risk register with a file path.

### 3.1 Deliverables

**`docs/audit/00-inventory.md`**
Module-by-module map of what exists. For each backend module and each frontend route: purpose, key files, approximate completeness (working / partial / stub), test coverage if any. Be specific — "partial" without saying what is missing is useless.

**`docs/audit/01-gap-analysis.md`**
For every capability in sections 4–13 of this spec, state one of: `EXISTS` (with file paths), `PARTIAL` (with what's there and what's missing), `MISSING`. This document is what the plan is built from, so it needs to be accurate rather than optimistic.

**`docs/audit/02-risk-register.md`**
Production blockers ranked by blast radius. For each: what breaks, who notices, how bad, file path, and rough fix size. Two I already know about — verify and confirm both:
- `appSecret` HMAC verification missing on the runtime WhatsApp webhook POST handler. Anyone with the URL can inject fake enquiries and trigger LLM spend.
- `WhatsAppWindowService.isWindowOpen()` exists but is never called in the send path. Free-form sends outside the 24-hour window fail silently and degrade Meta quality rating. Repeated violations restrict the client's number.

Find the rest yourself.

**`docs/audit/03-plan.md`**
The sequenced execution plan. Format defined in 3.3.

**`docs/audit/04-decisions.md`**
ADR-style entries for every decision you must make that this spec does not already lock. Each: context, options considered, choice, consequences, and what would make us revisit. Also the home for any challenge to section 2, with evidence.

### 3.2 Specific things to go and look at

Do not skim. These are the questions I want answered with file:line references.

**Webhooks and ingestion**
- Enumerate every webhook entry point. For each: signature verification present or absent, idempotency mechanism present or absent, what happens on provider retry.
- Is there a unique constraint on provider message ID anywhere? Meta and Gmail both redeliver. Without it, a busy day produces duplicate enquiries and duplicate auto-replies to the same lead.
- Ingestion path latency: how long from webhook receipt to persisted message to socket emit?

**Prisma schema**
- List every model with its relations.
- Flag every foreign key without an index, and every frequent query path without a supporting index.
- Flag every provider-supplied ID without a unique constraint.
- Flag anything that will need backfilling when the new tables in this spec land.

**AI call sites**
- Enumerate every place Gemini is called, with file:line. This scopes the `AiGateway` retrofit. If there are forty of them, I need to know before I plan the week.
- Note current model choice per call site and whether it's justified.

**Queues**
- Every BullMQ queue: retry policy, backoff, concurrency, whether the job handler is idempotent, what happens if the process dies mid-job.
- The follow-up scheduler specifically: verify the Postgres-as-truth + Redis-as-execution dual storage is actually reconciling correctly on startup, and that the daily replenish cron exists and works.

**WebSocket layer**
- Every `@SubscribeMessage` handler and every `@OnEvent` listener. Confirm the convention holds: all subscribe handlers in one gateway file, all event listeners in one handler file. Flag any that have drifted.
- Room membership: who can join what, and is authorization checked at every layer (REST, socket handler, eviction).
- Reconnection behaviour: what happens to messages that arrive while a client is disconnected?

**Auth and permissions**
- Every endpoint, and which guard protects it. Explicitly list any endpoint with no guard.
- CASL rule coverage per role. Any role that can reach data it shouldn't.

**Frontend**
- Every data-fetching pattern in use. Are they consistent?
- Every socket listener and what it does to local state. Flag any that trigger a full refetch on a message event.
- Query key construction — flag any unstable keys (object literals, arrays rebuilt per render) that cause refetch storms.
- Any list rendering more than ~100 rows without virtualization.
- Error boundaries: present or absent, and what the user sees when a page throws.

**Configuration and failure**
- Environment variables: which are validated at boot, which will crash at runtime on a typo. I want boot-time Zod validation of the whole env surface.
- Swallowed errors: every `catch` block that logs nothing or returns silently.
- Unhandled promise rejections in fire-and-forget paths.
- Graceful shutdown: does the process drain in-flight BullMQ jobs and close sockets, or does a deploy drop work on the floor?

### 3.3 Plan format

`03-plan.md` must be organised as **blocks**, each block being one reviewable commit boundary. Per block:

- **Name and one-line objective**
- **Why here in the order** — the actual dependency, not a vibe
- **Files created / modified**
- **Data model delta** — migration and rollback
- **Interfaces or contracts introduced**
- **Acceptance criteria** — verifiable, not aspirational. "Send outside the 24h window is rejected with a typed error and logged with contactId" not "window handling works."
- **How I verify it by hand** — what to click, what to curl, what to check in the DB
- **Estimated size** — S / M / L and rough hours
- **New concepts introduced** — anything I should understand before reviewing

Sequence the blocks. Mark which can run in parallel. Flag every hard dependency explicitly.

If the audit tells you my proposed ordering in section 4 is wrong, say so and re-sequence, with the reason.

---

## 4. Build blocks — the target

This is the scope. Ordering is my proposal; refine it against the audit.

### Block 1 — Trust and observability
Nothing else ships before this. Every later block adds surface area to a system that currently can't be debugged in production.

- HMAC signature verification on all inbound webhooks
- Idempotency: unique constraint on provider message ID + upsert path
- 24-hour window check wired into the WhatsApp send path, with typed rejection
- Boot-time Zod validation of the full environment surface
- `nestjs-pino` + `nestjs-cls`, structured logs with automatic context propagation
- Global exception filter — typed error taxonomy, nothing swallowed
- Sentry, backend and frontend, with release tagging
- `/health` and `/ready` endpoints that actually check DB, Redis, and adapter reachability
- Graceful shutdown draining BullMQ and closing sockets cleanly

### Block 2 — Channel abstraction
- `ChannelAdapter` interface with the capability flags from 2.3
- `ChannelConnection` registry — multiple accounts per channel, per-message `channelConnectionId` for correct outbound routing
- Adapter conformance test suite
- Refactor WhatsApp (Meta + Twilio) behind the interface without behaviour change

### Block 3 — Gmail adapter
- OAuth flow, token storage, refresh, revocation handling
- Pub/Sub push, not polling. `historyId` watermark with gap recovery.
- Threading: `threadId` plus `Message-ID` / `In-Reply-To` / `References` so replies land in the right thread on the recipient's side too
- Quoted reply-chain stripping before persistence and before embedding — otherwise every embedding call pays to re-read the whole thread
- Attachments, inline images, HTML-to-text normalisation
- Send routing per connected account
- Bounce and complaint handling

### Block 4 — Identity resolution
Data layer only. Invisible in the UI. Powers the Context Panel.

- Deterministic auto-link at confidence 1.0: normalised E.164 phone, lowercased email, platform user ID
- Probabilistic suggestion at 0.6–0.95: name similarity, company email domain, phone extracted from email signature → approval queue. Never auto-merge below threshold.
- Quote-link join key: the same tracked quote link opened from a WhatsApp click and an email click proves one human. The quote module doubles as an identity resolver.
- `MergeEvent` table — every merge fully reversible, both original contact IDs retained

### Block 5 — AiGateway, metering, credits
Build before any AI feature. Retrofitting metering into N call sites costs a week; doing it first costs two days.

- **Model router.** Classification and qualification → Flash-Lite. Drafting → Flash. Escalation and quote reasoning → Pro. Task-type-based, configurable, logged per call.
- **Semantic answer cache.** Embed the inbound, cosine against previously *approved* replies for this client. Above 0.95 similarity, reuse the approved answer. Costs one embedding call instead of a full RAG turn. Target: push the no-LLM rate from ~60% toward 80%.
- **Prompt caching.** System prompt + persona + catalog core is identical across calls. Gemini explicit caching, but it bills storage per hour — enable only above a computed per-client volume threshold. Below it, implicit caching only.
- **Batch lane.** Real-time: 90-second first touch, draft reply, Context Panel queries, qualification. Nightly batch at 50% cost: lead re-scoring, sentiment trajectory, catalog re-embedding, conversation digests, eval-set labeling. Nothing that carries a latency promise goes to batch.
- **Output caps.** `max_output_tokens` per task type. Output tokens bill 4–8x input.
- **`AiUsage`** row per call: model, input/output/cached token counts, cost in micro-cents, feature tag, `agentRunId`, latency. Cost table versioned by model + effective date so historical numbers stay true when pricing changes.
- **`CreditTransaction`** — append-only ledger, balance derived and cached. Reserve → commit → release. Never decrement a balance column directly; concurrent requests will spend past zero.
- **Circuit breaker.** Per-client daily ceiling with soft alert, then hard cap that degrades to draft-for-human-approval rather than failing loud. Note the connection to Block 1: an unauthenticated webhook plus an LLM call per message is a billing DoS.
- **Cost per conversation** must be queryable. I need it to price the product.

### Block 6 — Knowledge layer
- Catalog ingestion pipeline, versioned
- One chunk per SKU / service — catalog entries are already semantic units, do not naive-split at 512 tokens
- Price, category, SKU, availability as metadata columns, not embedded prose
- Re-embed on content hash change only
- Hybrid retrieval: pgvector + tsvector, RRF fusion, rerank, token-budgeted assembly
- Retrieval evaluation set with a small golden-question fixture so I can measure regressions instead of guessing

### Block 7 — AI features
- Grounded draft replies with mandatory citations. Draft-for-approval is the contract for all LLM replies except first touch.
- 90-second first-touch auto-reply, deterministic-first, LLM only when rules can't answer
- Qualification classifier on Flash-Lite
- Context Panel cross-channel Q&A, RAG scoped to `contactId`
- Agent chat — operator-facing, tool-using, reads over the client's own data
- `AgentRun` audit for every decision: inputs, retrieved chunk IDs, model, prompt version, output, cost, latency, human accept/reject/edit

### Block 8 — Frontend rebuild
- Channel routes per 2.1, each with its own list, filters, unread state
- TanStack Query with stable, factored query keys
- Socket events → surgical `setQueryData` patches
- Virtualized thread and message lists
- Optimistic send with rollback — a 400ms dead composer is what makes software feel cheap
- Error boundaries per route, with a real recovery path
- react-hook-form + Zod, schemas shared with backend DTOs
- Context Panel
- Loading, empty, and error states designed rather than defaulted

**On memoization:** `useCallback` / `useMemo` sprinkled everywhere is not the production fix and I don't want it. React 19's compiler covers most of it. The real killers are unstable query keys, invalidate-on-socket-event, missing virtualization, and no optimistic send. Fix those four, then profile, then memoize what the profiler names. Do not hand-memoize on spec.

### Block 9 — Quotations and the money loop
- `Quote` + `QuoteLineItem`, versioned on revision — never mutate a sent quote
- PDF generation, branded per client
- Tracked send link with view events: first view, view count, duration, device
- Accept / decline capture with signature or explicit confirmation
- Attribution: every quote links to the conversation and the enquiry that produced it
- View events feed both identity resolution (Block 4) and analytics (Block 10)

### Block 10 — Analytics
Materialized views with a refresh cron. Never live aggregation over the message table.

- Response time p50 / p90 / p99 — this is the proof of the 90-second claim, it needs to be defensible
- Funnel conversion by pipeline stage
- Revenue per channel, per source, per agent
- AI draft acceptance rate, and edit distance when edited
- Cost per conversation and cost per closed deal

### Block 11 — Production readiness
- Load test against realistic volume — establish where it actually breaks
- Migration rehearsal on a production-shaped dataset
- Backup and restore drill, timed, documented
- Runbook: common failures and their fixes
- Alerting on the things that actually matter: ingestion lag, 90-second SLA breach, queue depth, AI spend anomaly, adapter auth expiry
- Deployment: zero-downtime path, rollback procedure

---

## 5. How we work

### 5.1 Per-block protocol

**Before writing code:** post a short design note — files to be touched, interfaces, data model delta, migration and rollback, test plan, and the reasoning behind the approach. Then stop and wait for my go.

**After I approve:** implement that one block. Stop. Do not begin the next.

**On completion:** post a review guide — what to read in what order, what to verify by hand, and anything you were unsure about. I read every file before we move on.

Never batch two blocks. Never start the next one because it seemed obvious.

### 5.2 Teach as you go

I build to understand. When a block introduces a concept I may not have hit yet — RRF, reserve/commit/release ledgers, Pub/Sub watermarking, prompt cache economics — give me one tight paragraph on the mechanism and why it's the right tool. Not a tutorial. Enough that I can review the code critically and defend the choice to a client.

### 5.3 Code standards

- Self-documenting. One-line comment above each function stating what it does. Section separators between logical groups.
- No `any`. No unchecked casts. Typed errors, not thrown strings.
- No swallowed catch. Every catch either handles or rethrows with context.
- No TODOs left in merged code. Open items go in the plan doc, not the source.
- No complexity that isn't paying for itself. If a simpler structure works, use it and say why.
- No new dependency without: what it does, what it replaces, alternatives considered, bundle or runtime cost. I will reject packages that save twenty lines.
- Every schema change ships with a migration and a rollback.

### 5.4 Scope discipline

I have a known pattern of chasing new features mid-build. **Call it out when I do it.** If I ask for something not in this spec, tell me which block it belongs to and what it delays. Then do what I decide.

Same rule applies to you: if you find yourself adding something not in this document, stop and ask.

### 5.5 How to talk to me

Direct answer first. No preamble, no restating my question back to me, no summarising what I already said. If you have a strong read, give it straight — the move, the reason, the cost. Then it's my call. If I'm wrong, say so plainly with the evidence.

---

## 6. Start here

Run Phase 0 now.

Read the codebase properly — not a directory listing, the actual files. Then write the five documents in `docs/audit/`.

When they're done, post one short message: the three things that surprised you most, and what Block 1 looks like concretely against the real state of the code. Then wait.

Do not write production code until I approve the plan.