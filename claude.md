# CLAUDE.md

## Project
Enquiry Hub — Lead qualification + CRM. NestJS 11 backend, Next.js 16 frontend, monorepo.
Read ARCHITECTURE.md before building any new module.

## Commands
```bash
# Backend (cd backend)
npm run start:dev        # dev server
npm run worker           # automation worker — SEPARATE process, always run alongside
npm run seed:permissions # seed CASL permissions after schema change
npx prisma migrate dev   # after schema change
npx prisma generate      # after schema change

# Frontend (cd frontend)
npm run dev
```

## Non-negotiable Rules

**Prisma — always use pg adapter**
```typescript
// In workers/scripts only — services use injected PrismaService
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });
// NEVER: new PrismaClient() — breaks in production
```

**Outbound — never call Twilio/SendGrid directly**
```typescript
// Always emit, let OutboundService handle it
this.eventEmitter.emit('message.outbound', { messageId, channel, to, content });
```

**Auth — every protected route needs BOTH guards**
```typescript
@CheckAbility({ action: Action.Read, subject: 'enquiry' }) // CASL on top of global JWT
```

**Enquiry state — never update status directly**
// Always write EnquiryTimeline event alongside every status change
// Use enquiry.state.ts for valid transitions

**Contact is a person, not a phone number**
// Resolve ContactChannel → Contact before touching InboundMessage or Enquiry
// Never store phone/email directly on Enquiry

**Automation worker is a separate process**
// Don't import NestJS modules into automation.worker.ts — it has its own Prisma instance

## Stack
NestJS 11, Prisma 7 + pg adapter, PostgreSQL, BullMQ + Redis, CASL, Gemini AI, Twilio, SendGrid, Socket.io, Next.js 16, React 19, Zustand

## Code Style
- No `any` — proper TypeScript always
- All controller inputs: DTOs with class-validator
- Use `new Logger(ClassName.name)` not console.log
- Prisma transactions for multi-step writes: `prisma.$transaction([])`
- Enums from `@prisma/client` — never magic strings for status/channel values
- One module = one responsibility. See module boundary map in ARCHITECTURE.md

## Critical Gotchas
- Email adapter built but commented out in `channel-router.service.ts` — wire it before email outbound works
- `OutboundDraft` + `MessageAttachment` in schema, no controller yet
- Twilio webhook signature validation missing — add before production
- `@nestjs/throttler` not installed — add rate limiting before production
- Frontend UI components live in `components/ui/` — use these, don't add shadcn/radix