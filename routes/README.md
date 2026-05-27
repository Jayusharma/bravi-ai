# Enquiry Hub — Developer Navigation Guide

A route-by-route reference for new developers. Every entry is sourced from actual code — no assumptions.

---

## System Overview

**Enquiry Hub** is a lead qualification + CRM platform built on a NestJS 11 / Next.js 16 monorepo.

| Layer        | Tech                                         | Port / URL              |
|--------------|----------------------------------------------|-------------------------|
| Backend API  | NestJS 11, Prisma 7 + pg adapter, PostgreSQL | `http://localhost:3001` |
| Frontend     | Next.js 16 (App Router), React 19            | `http://localhost:3000` |
| Real-time    | Socket.IO (default namespace `/`)            | same port as backend    |
| Queue        | BullMQ + Redis                               | —                       |
| AI           | Gemini AI (lead qualification)               | —                       |
| SMS/WhatsApp | Twilio                                       | —                       |
| Email        | SendGrid                                     | —                       |
| File storage | Cloudflare R2 (S3-compatible)                | —                       |

**Global API prefix:** `/api/v1` — every backend REST endpoint starts here.

**Swagger docs:** `http://localhost:3001/api/docs`

---

## Auth Flow

```
1. User submits login form
   → POST /api/v1/auth/login
   → Backend returns { user, permissions[], token }
   → Frontend writes JWT to HttpOnly cookie (access_token, 30 days)

2. Every subsequent API call
   → apiClient reads cookie → attaches Authorization: Bearer <token>

3. WebSocket connection
   → frontend/lib/socket.ts calls GET /api/socket (Next.js route)
   → /api/socket reads HttpOnly cookie → returns { token }
   → Socket.IO connects with auth: { token }

4. Session check on dashboard pages
   → DashboardLayout (server component) calls getCurrentUser()
   → Redirects to /auth/login if no valid token

5. Permission checks (client)
   → DashboardLayout fetches /auth/me → passes user + permissions to AuthHydrator
   → AuthHydrator populates Zustand auth store + builds CASL ability
   → Any client component calls useAuthStore().can('read', 'enquiry')
```

---

## Frontend Pages

| Page                                      | Route           | File                                             | Permission Required | Type            |
|-------------------------------------------|-----------------|--------------------------------------------------|---------------------|-----------------|
| [Login](pages/login.md)                   | `/auth/login`   | `frontend/app/auth/login/page.tsx`               | None (public)       | Server          |
| [Dashboard](pages/dashboard.md)           | `/dashboard`    | `frontend/app/(dashboard)/dashboard/page.tsx`    | `read:dashboard`    | Server          |
| [Enquiry List](pages/enquiry-list.md)     | `/enquiry`      | `frontend/app/(dashboard)/enquiry/page.tsx`      | `read:enquiry`      | Server          |
| [Enquiry Detail](pages/enquiry-detail.md) | `/enquiry/[id]` | `frontend/app/(dashboard)/enquiry/[id]/page.tsx` | `read:enquiry`      | Server + Client |
| [Messaging](pages/messaging.md)           | `/messaging`    | `frontend/app/(dashboard)/messaging/page.tsx`    | `read:enquiry`      | Client          |
| [Permissions](pages/permissions.md)       | `/permissions`  | `frontend/app/(dashboard)/permissions/page.tsx`  | `read:permission`   | Server          |
| [Playground](pages/playground.md)         | `/playground`   | `frontend/app/(dashboard)/playground/page.tsx`   | Session only        | Client          |

### Root redirect
`frontend/app/page.tsx` — checks session and redirects to `/dashboard` (authed) or `/auth/login` (not authed).

---

## Frontend Layout Tree

```
app/layout.tsx                  ← RootLayout: ThemeProvider + ToastProvider
  app/auth/login/page.tsx       ← public, no sidebar
  app/(dashboard)/layout.tsx    ← DashboardGroupLayout
    └─ DashboardLayout          ← frontend/components/dashboard/DashboardLayout.tsx
         ├─ getCurrentUser()    ← session check, redirect if invalid
         ├─ AuthHydrator        ← hydrate Zustand store (client)
         └─ SidebarClient       ← resizable sidebar shell
              └─ <children>     ← page content
```

---

## Key Frontend Files

| File                                          | Purpose                                                            |
|-----------------------------------------------|--------------------------------------------------------------------|
| `frontend/lib/socket.ts`                      | Singleton Socket.IO client; token relay; room auto-rejoin          |
| `frontend/lib/api-client.ts`                  | Typed HTTP client; reads cookie; unwraps `{success,data}` envelope |
| `frontend/lib/endpoints.ts`                   | All API URL constants                                              |
| `frontend/lib/Auth.ts`                        | Cookie read/write/clear (server-only)                              |
| `frontend/lib/upload.ts`                      | XHR-based file upload with progress; size validation               |
| `frontend/lib/navigation.tsx`                 | Sidebar nav items with permission guards                           |
| `frontend/stores/auth-store.ts`               | Zustand store: user, CASL ability, `can()` helper                  |
| `frontend/hooks/useUpload.ts`                 | Multi-file upload queue with abort/retry                           |
| `frontend/components/auth/AuthHydrator.tsx`   | Client component: loads session into Zustand                       |
| `frontend/components/auth/PermissionGate.tsx` | Wraps UI/pages behind a CASL check                                 |

---

## Key Backend Files

| File                                                         | Purpose                                                   |
|--------------------------------------------------------------|-----------------------------------------------------------|
| `backend/src/main.ts`                                        | Bootstrap: global prefix, Redis IO adapter, CORS, Swagger |
| `backend/src/app.module.ts`                                  | Module registry: JWT APP_GUARD, BullMQ, EventEmitter2     |
| `backend/src/adapters/redis-io.adapter.ts`                   | Redis pub/sub for horizontal WS scaling                   |
| `backend/src/modules/messaging/messaging.gateway.ts`         | Inbound message WS fan-out, contact-list broadcast        |
| `backend/src/modules/outbound/outbound.gateway.ts`           | Delivery updates, typing, presence, reactions             |
| `backend/src/modules/ingestion/ingestion.service.ts`         | 4-path inbound message routing logic                      |
| `backend/src/modules/qualification/qualification.service.ts` | Gemini AI lead classifier                                 |
| `backend/src/modules/outbound/outbound.processor.ts`         | BullMQ job processor for email/WhatsApp                   |
| `backend/src/modules/outbound/channel-router.service.ts`     | Routes jobs to EmailAdapter / WhatsAppAdapter             |
| `backend/src/modules/storage/storage.service.ts`             | Cloudflare R2 upload/delete/presigned URL                 |
| `backend/src/modules/casl/casl-ability.factory.ts`           | Builds CASL ability from DB RolePermission records        |
| `backend/prisma/schema.prisma`                               | Full database schema                                      |

---

## Documentation Files in This Folder

| File                                                   | Contents                                                                      |
|--------------------------------------------------------|-------------------------------------------------------------------------------|
| [`api-registry.md`](api-registry.md)                   | Every REST endpoint, BullMQ queue, and internal EventEmitter2 event           |
| [`events-and-websockets.md`](events-and-websockets.md) | Socket.IO connection, room system, all 15+ WS events with ASCII flow diagrams |
| [`pages/login.md`](pages/login.md)                     | Login page detail                                                             |
| [`pages/dashboard.md`](pages/dashboard.md)             | Dashboard page detail                                                         |
| [`pages/enquiry-list.md`](pages/enquiry-list.md)       | Enquiry list page detail                                                      |
| [`pages/enquiry-detail.md`](pages/enquiry-detail.md)   | Enquiry detail page detail                                                    |
| [`pages/messaging.md`](pages/messaging.md)             | Messaging page detail                                                         |
| [`pages/permissions.md`](pages/permissions.md)         | Permissions page detail                                                       |
| [`pages/playground.md`](pages/playground.md)           | Dev playground page detail                                                    |

---

## Critical Architecture Rules

From `CLAUDE.md` — these rules are non-negotiable:

1. **Prisma — always use pg adapter.** `new PrismaClient()` alone breaks in production.

2. **Outbound — never call Twilio/SendGrid directly.** Always `eventEmitter.emit('message.outbound', ...)`. `OutboundService` handles delivery.

3. **Auth — every protected route needs BOTH guards.** Global JWT guard (via `APP_GUARD`) plus `@CheckAbility(...)` for CASL.

4. **Enquiry state — never update status directly.** Always write an `EnquiryTimeline` event. Use `enquiry.state.ts` for valid transitions.

5. **Contact is a person, not a phone number.** Resolve `ContactChannel → Contact` before touching `InboundMessage` or `Enquiry`. Never store phone/email on `Enquiry`.

6. **Automation worker is a separate process.** Don't import NestJS modules into `automation.worker.ts`.

---

## Known Gaps / TODOs (from code inspection)

| Issue                                          | Location                                                                                                    |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Email adapter commented out                    | `backend/src/modules/outbound/channel-router.service.ts` — wire before email outbound works                 |
| Twilio webhook signature validation missing    | `backend/src/modules/webhooks/webhook.controller.ts`                                                        |
| Rate limiting not installed                    | `@nestjs/throttler` not in package.json                                                                     |
| `outbound:draft_saved` WS event unhandled      | Emitted by OutboundGateway, no frontend listener                                                            |
| `outbound:retry_queued` WS event unhandled     | Emitted by OutboundGateway, no frontend listener                                                            |
| `outbound:attachment_added` WS event unhandled | Emitted by OutboundGateway, no frontend listener                                                            |
| `presence:online/offline` WS events unhandled  | Emitted by OutboundGateway, no frontend listener                                                            |
| Qualification controller empty                 | `backend/src/modules/qualification/qualification.controller.ts` — no REST endpoints for qualification rules |
| Both gateways run handleConnection             | `MessagingGateway` + `OutboundGateway` each verify JWT on every connection                                  |
| Typo in route                                  | `PATCH /enquiry/qualfiy` (should be `qualify`)                                                              |
