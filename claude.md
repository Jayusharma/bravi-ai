# CLAUDE.md

## Project
EnquiryHub — single-tenant lead qualification + multi-channel messaging CRM. NestJS 11 backend
(`backend/`), Python FastAPI AI brain (`ai/`), Next.js 16 frontend (`frontend/`), monorepo.
**Read `ARCHITECTURE.md` before building any module. Read `docs/audit/` before touching Block-1 areas.**

## Commands
```bash
# Backend (cd backend)
npm run start:dev        # dev API — also runs all BullMQ workers IN-PROCESS today (see gotcha)
npm run worker           # ⚠ BROKEN: targets src/modules/automation/automation.worker.ts which does NOT exist
npm run seed:permissions # seed CASL role→permission rows after a permission change
npx prisma migrate dev   # after schema change
npx prisma generate      # after schema change

# Frontend (cd frontend)
npm run dev

# AI brain (cd ai) — FastAPI, needs GOOGLE_API_KEY + DATABASE_URL
uvicorn main:app --reload --port 8000
```

## Non-negotiable Rules

**Prisma — always use the pg adapter**
```typescript
// Services use the injected PrismaService (already pg-adapter). In workers/scripts only:
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });
// NEVER bare `new PrismaClient()` — breaks in production.
```

**Outbound — never call Twilio/SendGrid/Meta directly**
```typescript
this.eventEmitter.emit('message.outbound', { messageId, channel, to, content });
// OutboundService → OutboundProcessor → ChannelRouterService → adapter handles the wire call.
```

**Auth — every protected route needs BOTH guards**
```typescript
@CheckAbility({ action: 'read', subject: 'enquiry' }) // CASL on top of the global JwtAuthGuard
// NOTE: CaslGuard is applied PER-CONTROLLER today and two controllers slip it (user, permission).
// Until Block 1 makes it global, add @UseGuards(CaslGuard) to the class AND @CheckAbility per route.
// @Public() opts a route out of JWT (use only for webhooks/login).
```

**Enquiry state — never write status directly**
```
Use enquiry.state.ts (ENQUIRY_TRANSITIONS) to validate, and write an EnquiryTimeline row alongside
EVERY status change. (The ingestion fast-path currently violates this — see gotchas.)
```

**Contact is a person, not an address**
```
Resolve ContactChannel → Contact before touching InboundMessage or Enquiry.
Never store phone/email directly on Enquiry.
```

**Realtime — one gateway, one listener file**
```
ALL @SubscribeMessage handlers → websocket/app.gateway.ts.
ALL @OnEvent socket-emitting listeners → events/app.event-handler.ts.
```

## Stack
NestJS 11 · Prisma 7 + pg adapter · PostgreSQL · BullMQ + Redis · CASL · Socket.IO (Redis adapter) ·
Python FastAPI + Gemini · Twilio · SendGrid · Meta WhatsApp Cloud API · Next.js 16 · React 19 · Zustand.

## Code Style
- No `any` — proper TypeScript, typed errors not thrown strings.
- All controller inputs: DTOs with class-validator.
- `new Logger(ClassName.name)` — not `console.log` (there is a stray one in `app.gateway.ts` to remove).
- Multi-step writes: `prisma.$transaction`.
- Enums from `@prisma/client` — never magic strings for status/channel.
- One module = one responsibility (module boundary map in `ARCHITECTURE.md`).

## Critical Gotchas (verified — full detail in `docs/audit/02-risk-register.md`)
- **`POST /users` is `@Public()` and `role` is client-settable** → anyone can create an ADMIN (R0). Do not build on this path; it's the first Block-1 fix.
- **No signature verification on inbound webhooks** (Twilio/SendGrid/Meta) or `POST /ingestion/message` (R1). Meta connection stores no `appSecret`. (Outbound Twilio delivery callback IS verified.)
- **`WhatsAppWindowService.isWindowOpen()` is never called** in the send path (R2) — free-form sends outside 24h fail at Meta.
- **JWT secret mismatch:** signing `JWT_SECRET` vs verifying `JWT_SECERET` (typo), both fall back to `'dev-secret'` (R3).
- **`npm run worker` is broken** — `automation.worker.ts` doesn't exist; all `@Processor`s run in the API process (R6).
- No graceful shutdown (R7), no env validation (R9), no `@nestjs/throttler`/helmet (R10).
- Rule-engine layers are modeled in schema but **never executed** — qualification is AI-only (R13).
- Frontend UI primitives live in `components/ui/` — use them; don't add shadcn/radix. Frontend has **no** TanStack Query / virtualization / error boundaries yet (Block 8).

## Stale claims corrected (were in the old CLAUDE.md)
- The Email adapter is **wired** via `AdapterFactory` (`adapter.factory.ts`), not commented out.
- `OutboundDraft` **has** a controller (`outbound/draft.controller.ts`); `MessageAttachment` upload goes through `storage`.
- Twilio signature validation **exists** on the outbound delivery callback (`outbound.controller.ts:148`) — it's the **inbound** webhooks that lack it.
