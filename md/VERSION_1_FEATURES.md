# Enquiry Management System — Version 1 Feature Specification

> **Last updated:** 2026-02-12
> **Status:** Draft — Version 1 Scope

---

## Table of Contents

1. [Vision & Objectives](#1-vision--objectives)
2. [Architecture Overview](#2-architecture-overview)
3. [What Already Exists (Audit)](#3-what-already-exists-audit)
4. [V1 Feature List (Detailed)](#4-v1-feature-list-detailed)
   - 4.1 [Multi-Channel Ingestion Pipeline](#41-multi-channel-ingestion-pipeline)
   - 4.2 [AI-Powered Lead Qualification](#42-ai-powered-lead-qualification)
   - 4.3 [Enquiry Lifecycle & Finite State Machine (FSM)](#43-enquiry-lifecycle--finite-state-machine-fsm)
   - 4.4 [Authorization & Permissions (CASL)](#44-authorization--permissions-casl)
   - 4.5 [User & Team Management](#45-user--team-management)
   - 4.6 [Enquiry Dashboard & UI](#46-enquiry-dashboard--ui)
   - 4.7 [Enquiry Detail View & Timeline](#47-enquiry-detail-view--timeline)
   - 4.8 [Automation Engine (No Lead Left Behind)](#48-automation-engine-no-lead-left-behind)
   - 4.9 [Notification System](#49-notification-system)
   - 4.10 [Message Thread & Communication Log](#410-message-thread--communication-log)
   - 4.11 [Idempotency & Data Integrity](#411-idempotency--data-integrity)
   - 4.12 [Authentication & Security Hardening](#412-authentication--security-hardening)
   - 4.13 [Audit Trail & Observability](#413-audit-trail--observability)
   - 4.14 [API Design & Standards](#414-api-design--standards)
   - 4.15 [Database Schema Improvements](#415-database-schema-improvements)
5. [Post-V1 Roadmap (Brief)](#5-post-v1-roadmap-brief)

---

## 1. Vision & Objectives

Build an **enterprise-grade Enquiry Management System** that:

- **Captures** leads from WhatsApp and Email automatically via webhooks.
- **Filters** incoming messages using AI to separate **real enquiries** from noise (spam, auto-replies, irrelevant messages).
- **Tracks** every enquiry through a well-defined lifecycle so **no lead is ever missed**.
- **Automates** follow-ups, escalations, and reminders to ensure timely responses.
- **Scales** from Day 1 with clean patterns (CASL, FSM, event-driven queues, idempotency).

### Non-Goals for V1
- CRM-level deal/pipeline management.
- Payment or invoicing integrations.
- Multi-tenant / multi-organization support.
- Mobile app.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                          │
│  Login ─ Dashboard ─ Enquiry List ─ Detail/Timeline ─ Users        │
│  (Server Components + Server Actions + API Proxy)                  │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ HTTP (cookies)
┌─────────────────────────────▼────────────────────────────────────────┐
│                        BACKEND (NestJS)                             │
│                                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────┐        │
│  │ Auth     │  │ User &    │  │ Enquiry  │  │ Ingestion    │        │
│  │ Module   │  │ CASL      │  │ Module   │  │ Pipeline     │        │
│  └──────────┘  └───────────┘  └──────────┘  └──────┬───────┘        │
│                                                     │                │
│  ┌──────────────────────┐  ┌────────────────────────▼──────┐        │
│  │ Automation Worker    │  │  AI Qualification Service     │        │
│  │ (BullMQ)             │  │  (OpenAI / Rules Engine)      │        │
│  └──────────────────────┘  └───────────────────────────────┘        │
│                                                                      │
│  ┌─────────┐  ┌──────────────────┐  ┌────────────────────┐          │
│  │ Prisma  │  │ Redis (BullMQ)   │  │ Event Emitter      │          │
│  │ (PG)    │  │ (Queues/Cache)   │  │ (NestJS Events)    │          │
│  └─────────┘  └──────────────────┘  └────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
                              │
      ┌───────────────────────┼───────────────────────┐
      │                       │                       │
┌─────▼──────┐  ┌─────────────▼───────┐  ┌───────────▼────────┐
│ WhatsApp   │  │ Email (SendGrid/    │  │ Manual Entry       │
│ Webhook    │  │ Mailgun Webhook)    │  │ (Dashboard Form)   │
└────────────┘  └─────────────────────┘  └────────────────────┘
```

---

## 3. What Already Exists (Audit)

| Area | Status | Notes |
|------|--------|-------|
| **Auth** | ✅ Basic | JWT login, bcrypt passwords, JwtAuthGuard as global guard |
| **User** | ✅ Basic | CRUD with 3 roles (ADMIN, SALES, OPS) — no permission granularity |
| **Enquiry** | ✅ Partial | Create, status change (FSM), assign, sendMessage |
| **Ingestion** | ✅ Partial | Email webhook ingestion with idempotency middleware |
| **WhatsApp** | ❌ Missing | Only email webhook exists |
| **AI Qualification** | ❌ Missing | No filtering of real vs. noise messages |
| **Automation** | ✅ Basic | BullMQ worker for follow-up on QUOTATION_SENT only |
| **Roles/Permissions** | ⚠️ Minimal | Simple `@Roles()` decorator — no attribute-based or resource-level checks |
| **Frontend** | ✅ Skeleton | Login, users page, basic enquiry list — no detail view, no dashboard metrics |
| **Idempotency** | ✅ Done | Idempotency guard + middleware + interceptor |
| **Notifications** | ❌ Missing | No in-app or external notifications |

---

## 4. V1 Feature List (Detailed)

---

### 4.1 Multi-Channel Ingestion Pipeline

**Goal:** Accept messages from WhatsApp and Email, normalize them into a unified format, and feed them into the qualification + enquiry pipeline.

#### 4.1.1 Email Webhook (Improve Existing)
- **Current state:** Email webhook exists but is bare-bones.
- **V1 improvements:**
  - Add **signature/verification** for the incoming webhook (e.g., SendGrid signed event webhook verification or Mailgun signature validation) to prevent spoofing.
  - Parse and store **attachments metadata** (file name, size, MIME type, storage URL) — actual file storage can be S3 or local disk.
  - Extract **reply-to threading** — detect if an email is a reply to a previous outbound message and link it to the correct enquiry conversation thread.
  - Handle **bounce / complaint** webhook events gracefully (mark email as undeliverable on the enquiry).
  - Add **rate limiting** on the webhook endpoint to prevent abuse.

#### 4.1.2 WhatsApp Webhook (New)
- Integrate with **WhatsApp Business API** (via Meta Cloud API or a provider like Twilio/360dialog).
- Create `POST /webhook/whatsapp` endpoint:
  - Verify the webhook using Meta's **hub.verify_token** challenge for registration.
  - Handle incoming message types: **text**, **image**, **document**, **location**.
  - Normalize all incoming WhatsApp messages into the shared `IncomingMessageDto` format.
  - Store the WhatsApp `messageId` as `externalId` for deduplication.
- Map incoming phone numbers to existing enquiries (or create new ones).
- Support **WhatsApp message status callbacks** (sent, delivered, read) — store as message metadata.

#### 4.1.3 Unified Ingestion Service (Refactor)
- Refactor `IngestionService` into a clean pipeline:
  ```
  Webhook → Normalize → Deduplicate → Qualify (AI) → Upsert Enquiry → Emit Event
  ```
- Every step is a discrete method for testability and extensibility.
- Emit a `enquiry.message.received` event after successful ingestion so other modules (notifications, automation) can react.

---

### 4.2 AI-Powered Lead Qualification

**Goal:** Automatically classify incoming messages as **real enquiry** vs. **noise** so only genuine leads enter the tracking pipeline.

#### 4.2.1 Qualification Service
- Create `QualificationService` that analyzes each incoming message.
- **Strategy Pattern** — pluggable qualification strategies:
  - **Rule-Based Strategy (default, always active):**
    - Reject auto-reply patterns (`"Out of office"`, `"I am currently unavailable"`, `"Automatic reply"`).
    - Reject known spam patterns (excessive links, known spam phrases).
    - Reject system/transactional emails (noreply@, mailer-daemon@).
    - Detect the presence of **question marks, pricing keywords, product names, "interested in", "quotation"** → high-confidence real enquiry.
  - **AI Strategy (OpenAI-based, optional, toggle via env flag):**
    - Send the message content to OpenAI's API (GPT-4o-mini for cost efficiency) with a classification prompt.
    - Prompt template: *"Classify the following message as REAL_ENQUIRY, SPAM, AUTO_REPLY, or IRRELEVANT. Respond with JSON: { classification, confidence, reason }."*
    - Cache classification results by content hash to avoid re-processing duplicate messages.
    - Use a **confidence threshold** (configurable, default: 0.7) — if below threshold, mark as `NEEDS_REVIEW` for manual triage.

#### 4.2.2 Classification Outcome & Data Model
- Add a `classification` field to the `Message` model:
  ```prisma
  enum MessageClassification {
    REAL_ENQUIRY
    SPAM
    AUTO_REPLY
    IRRELEVANT
    NEEDS_REVIEW
  }
  ```
- Messages classified as `REAL_ENQUIRY` or `NEEDS_REVIEW` → create/update the enquiry.
- Messages classified as `SPAM`, `AUTO_REPLY`, `IRRELEVANT` → still stored for audit but **do not** create an enquiry or notification.
- Admin can **override** classification manually from the dashboard (reclassify a message).

#### 4.2.3 Manual Review Queue
- UI screen showing messages marked as `NEEDS_REVIEW`.
- Admin/Sales can approve (promote to real enquiry) or reject (mark as spam/irrelevant).
- Action creates a timeline entry for audit.

---

### 4.3 Enquiry Lifecycle & Finite State Machine (FSM)

**Goal:** Enforce a strict, auditable lifecycle for every enquiry so status transitions are always valid, and provide a richer set of states for V1.

#### 4.3.1 Expanded State Machine
Current states are too limited. V1 states:

```
NEW → OPEN → IN_PROGRESS → QUOTATION_SENT → FOLLOW_UP → CONVERTED → CLOSED_LOST
                                                        ↗
NEW → OPEN → CLOSED_LOST (can close from any open state)
```

| State | Description |
|-------|-------------|
| `NEW` | Just ingested, not yet reviewed by any team member |
| `OPEN` | Reviewed & acknowledged, work is beginning |
| `IN_PROGRESS` | Actively working on the enquiry (calls, emails, research) |
| `QUOTATION_SENT` | Formal quotation/proposal has been sent to the lead |
| `FOLLOW_UP` | Follow-up required — waiting for customer response |
| `CONVERTED` | Lead successfully converted (deal won) |
| `CLOSED_LOST` | Lead lost — closed without conversion |

#### 4.3.2 Transition Rules (State Machine Config)
```typescript
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW:             ['OPEN', 'CLOSED_LOST'],
  OPEN:            ['IN_PROGRESS', 'QUOTATION_SENT', 'CLOSED_LOST'],
  IN_PROGRESS:     ['QUOTATION_SENT', 'FOLLOW_UP', 'CLOSED_LOST'],
  QUOTATION_SENT:  ['FOLLOW_UP', 'CONVERTED', 'CLOSED_LOST'],
  FOLLOW_UP:       ['IN_PROGRESS', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST'],
  CONVERTED:       [],  // Terminal state
  CLOSED_LOST:     ['OPEN'],  // Reopen capability
};
```

#### 4.3.3 Side Effects on Transition
- Implement a **Transition Side-Effect Handler** pattern:
  - `→ QUOTATION_SENT`: Schedule follow-up automation job (already partially done).
  - `→ FOLLOW_UP`: Schedule escalation if no response in X hours.
  - `→ CONVERTED`: Send internal notification, stop all automation jobs.
  - `→ CLOSED_LOST`: Stop all automation jobs, record lost reason (new field).
  - `← QUOTATION_SENT` (leaving): Cancel scheduled follow-up job.
- Use NestJS `EventEmitter2` to decouple side effects from the core state change.

#### 4.3.4 Optimistic Concurrency (Already Exists — Improve)
- The `version` field already exists for optimistic locking — keep this.
- Improve error messages to provide the current version in the ConflictException so clients can retry intelligently.

---

### 4.4 Authorization & Permissions (CASL)

**Goal:** Replace the simple `@Roles()` decorator with **CASL** (Attribute-Based Access Control) for fine-grained, scalable permission management.

#### 4.4.1 Why CASL Over Simple Roles
- Current `RolesGuard` only checks if `user.role` is in a list — no resource-level or field-level control.
- CASL allows rules like: *"SALES can only update enquiries assigned to them"*, *"OPS can view but not delete"*.
- CASL abilities are **serializable** — can be sent to the frontend for UI-level permission checks (show/hide buttons).

#### 4.4.2 CASL Implementation Plan
1. **Install:** `@casl/ability` and `@casl/prisma` packages.
2. **Define Subjects:**
   ```typescript
   type Subjects = 'Enquiry' | 'User' | 'Message' | 'all';
   type Actions = 'create' | 'read' | 'update' | 'delete' | 'assign' | 'manage';
   ```
3. **Define Ability Factory** (`casl-ability.factory.ts`):
   ```typescript
   // ADMIN: full access
   can('manage', 'all');

   // SALES:
   can('read', 'Enquiry');
   can('update', 'Enquiry', { assignedToId: user.id });
   can('create', 'Enquiry');
   can('read', 'Message');
   can('create', 'Message', { enquiryId: { assignedToId: user.id } });
   cannot('delete', 'Enquiry');

   // OPS:
   can('read', 'Enquiry');
   can('read', 'Message');
   cannot('update', 'Enquiry');
   cannot('delete', 'Enquiry');
   ```
4. **CASL Guard** (`PoliciesGuard`):
   - Replaces the current `RolesGuard`.
   - Works via a `@CheckPolicies()` decorator that accepts a policy handler.
   - Policy handlers receive the CASL `Ability` and the request, and return `true`/`false`.
5. **Frontend CASL Sync:**
   - On login, return the user's **packed rules** in the auth response.
   - Frontend uses `@casl/react` to conditionally render UI elements (buttons, menu items).
   - Example: Sales user doesn't see "Delete Enquiry" button.

#### 4.4.3 Role Expansion
Current roles: `ADMIN`, `SALES`, `OPS`. For V1, add:
- **`MANAGER`** — can view all enquiries, reassign, but cannot delete users or change system settings.

```prisma
enum UserRole {
  ADMIN
  MANAGER
  SALES
  OPS
}
```

---

### 4.5 User & Team Management

**Goal:** Manage internal users (staff) who operate the enquiry system.

#### 4.5.1 Enhanced User Model
```prisma
model User {
  id          String    @id @default(uuid())
  userName    String    @unique
  email       String    @unique
  displayName String
  password    String
  role        UserRole
  isActive    Boolean   @default(true)
  lastLoginAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  assignedEnquiries Enquiry[] @relation("EnquiryAssignment")
}
```

#### 4.5.2 User CRUD Endpoints
| Endpoint | Method | Access | Description |
|----------|--------|--------|-------------|
| `GET /users` | GET | ADMIN, MANAGER | List all users with filters (role, active status) |
| `GET /users/:id` | GET | ADMIN, MANAGER | Get single user details |
| `POST /users` | POST | ADMIN | Create a new user |
| `PATCH /users/:id` | PATCH | ADMIN | Update user (role, active status, display name) |
| `DELETE /users/:id` | DELETE | ADMIN | Soft-delete (set isActive = false) — never hard delete |
| `PATCH /users/:id/password` | PATCH | ADMIN, Self | Reset/change password |

#### 4.5.3 User Features
- **Soft delete** — deactivated users can't log in but their historical data (assigned enquiries, timeline events) remains intact.
- **Password policy** — minimum 8 characters, at least 1 uppercase, 1 number (validated via class-validator custom decorator).
- **Profile endpoint** (`GET /auth/me`) — returns current user's profile + CASL abilities.

---

### 4.6 Enquiry Dashboard & UI

**Goal:** A rich, actionable dashboard that gives an instant overview of all enquiries and their status.

#### 4.6.1 Dashboard KPI Cards
Top-level stats cards showing:
- **Total Enquiries** (all time) with a sparkline trend (last 7 days).
- **New Today** — enquiries created today.
- **Pending Follow-ups** — enquiries in `FOLLOW_UP` state.
- **Unassigned** — enquiries with no `assignedToId`.
- **Conversion Rate** — `CONVERTED / total * 100` (last 30 days).
- **Average Response Time** — time from `NEW` → first outbound message.

#### 4.6.2 Enquiry List View (Enhance Existing)
Improve the current basic table:
- **Sortable columns:** Name, Status, Source, Created Date, Assigned To.
- **Filterable:** By status, source (WhatsApp/Email/Manual), assigned user, date range.
- **Searchable:** Full-text search on name, email, phone.
- **Pagination:** Server-side cursor-based pagination (scalable for large datasets).
- **Bulk actions:** Select multiple → assign to user, change status.
- **Status badges** with color coding:
  - `NEW` = Blue, `OPEN` = Yellow, `IN_PROGRESS` = Orange, `QUOTATION_SENT` = Purple, `FOLLOW_UP` = Red (attention), `CONVERTED` = Green, `CLOSED_LOST` = Gray.
- **Source icons:** WhatsApp icon (green), Email icon (blue), Manual icon (gray).
- **Quick actions** per row: Assign, Change Status (dropdown), View Detail.

#### 4.6.3 Kanban Board View (Alternative)
- Drag-and-drop Kanban board where each column is a status.
- Drag an enquiry card to a new column → triggers status transition (with FSM validation).
- Shows assignee avatar, source icon, and time since last activity on each card.

#### 4.6.4 API Endpoints for Dashboard
| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /enquiry/stats` | GET | Returns dashboard KPI data |
| `GET /enquiry` | GET | List with filters, sorting, pagination |
| `GET /enquiry/:id` | GET | Full detail with timeline + messages |

---

### 4.7 Enquiry Detail View & Timeline

**Goal:** A comprehensive single-enquiry view showing all information, communication history, and an audit timeline.

#### 4.7.1 Detail Page Sections
1. **Header:** Name, email, phone, source badge, current status badge, assigned user.
2. **Action Bar:** Change Status (dropdown with valid transitions only), Reassign, Send Message, Mark as Converted/Lost.
3. **Timeline Tab:**
   - Chronological list of all events: created, status changes, messages sent/received, follow-ups, assignments.
   - Each event shows: timestamp, actor (user or SYSTEM), event type, details.
   - Visually distinct styles for inbound messages (left-aligned, customer color) vs. outbound (right-aligned, staff color).
4. **Messages Tab:**
   - Threaded conversation view showing all messages for this enquiry.
   - Compose box at the bottom to send a new message (select channel: Email or WhatsApp).
5. **Info Panel (Sidebar):**
   - Contact details (editable).
   - Enquiry metadata: source, created date, last activity, response time.
   - Assignment history.
   - Tags (for V1: simple text tags for categorization, e.g., "Urgent", "VIP", "Price Inquiry").

#### 4.7.2 Tags System (Lightweight)
- Add a `tags` field to the Enquiry model: `tags String[] @default([])`.
- Predefined tag suggestions but also allow custom tags.
- Filterable in the enquiry list by tags.

---

### 4.8 Automation Engine (No Lead Left Behind)

**Goal:** Ensure every enquiry gets timely attention through automated follow-ups, escalations, and reminders.

#### 4.8.1 Automation Rules (Configurable)
Define automation rules as database-stored configurations (not hardcoded):

```prisma
model AutomationRule {
  id          String   @id @default(uuid())
  name        String
  description String?
  isActive    Boolean  @default(true)

  // Trigger
  triggerEvent  String   // e.g., "enquiry.status.changed", "enquiry.no_response"
  triggerCondition Json? // e.g., { "status": "NEW", "minutesSinceCreated": 30 }

  // Action
  actionType  String   // "send_notification", "change_status", "assign_user", "send_message"
  actionConfig Json    // e.g., { "notifyRole": "ADMIN", "message": "..." }

  delayMinutes Int     @default(0) // Delay before executing action

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

#### 4.8.2 Built-in V1 Automation Rules
| # | Rule Name | Trigger | Action | Delay |
|---|-----------|---------|--------|-------|
| 1 | **New Enquiry Alert** | Enquiry created | Notify all ADMIN & MANAGER users | 0 min |
| 2 | **Unassigned Reminder** | Enquiry is still `NEW` and unassigned | Notify ADMIN | 30 min |
| 3 | **Stale Enquiry Escalation** | Enquiry is `OPEN` with no activity | Notify assigned user + MANAGER | 4 hours |
| 4 | **Follow-Up Reminder** | Enquiry moves to `QUOTATION_SENT` | Schedule reminder to assigned user | 24 hours |
| 5 | **Missed Follow-Up Escalation** | Enquiry is `FOLLOW_UP` with no customer reply | Escalate to MANAGER, send follow-up | 48 hours |
| 6 | **Customer Replied** | Customer sends a new message | Notify assigned user instantly | 0 min |
| 7 | **SLA Breach Warning** | No outbound message within 2 hours of a new enquiry | Notify ADMIN + assigned user | 2 hours |

#### 4.8.3 BullMQ Worker Improvements
- Current worker only handles `QUOTATION_SENT` follow-up — expand to a **generic automation processor**.
- Job types: `follow_up`, `escalation`, `notification`, `status_change`.
- Each job re-fetches current state before acting (already done — keep this pattern).
- Add **dead-letter queue** for permanently failed jobs.
- Add **job scheduling dashboard** (admin-only) showing upcoming, completed, and failed automation jobs.

#### 4.8.4 Recurring Check Worker (Cron-Based)
- Use `@nestjs/schedule` to run periodic checks:
  - Every 15 minutes: scan for enquiries in `NEW` status > 30 minutes old with no assignee.
  - Every 1 hour: scan for enquiries in `OPEN`/`IN_PROGRESS` with no activity in 4+ hours.
  - Every 6 hours: scan for stale `FOLLOW_UP` enquiries.
- These cron jobs add items to BullMQ for processing (don't process inline in the cron).

---

### 4.9 Notification System

**Goal:** Keep the team informed about enquiry events in real-time.

#### 4.9.1 Notification Model
```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])

  type      String   // "new_enquiry", "assignment", "follow_up_due", "escalation", "customer_replied"
  title     String
  body      String
  metadata  Json?    // { enquiryId, messageId, etc. }

  isRead    Boolean  @default(false)
  readAt    DateTime?

  createdAt DateTime @default(now())
}
```

#### 4.9.2 Notification Channels (V1)
- **In-App Notifications:**
  - Bell icon in the top nav with unread count badge.
  - Dropdown panel showing recent notifications.
  - Mark as read / mark all as read.
  - Click → navigate to the relevant enquiry detail page.
- **Email Notifications (Optional, configurable per user):**
  - Critical events only: SLA breach, escalation, new enquiry (if user opts in).
  - Use a transactional email service (SendGrid/Mailgun — same provider as webhook integration).

#### 4.9.3 Real-Time Delivery
- Use **Server-Sent Events (SSE)** for real-time notification push to the frontend.
  - SSE is simpler than WebSockets and sufficient for one-way server→client notifications.
  - Endpoint: `GET /notifications/stream` (authenticated, long-lived connection).
- Fallback: polling every 30 seconds if SSE connection drops.

#### 4.9.4 API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /notifications` | GET | List notifications for current user (paginated) |
| `GET /notifications/unread-count` | GET | Returns `{ count: number }` |
| `PATCH /notifications/:id/read` | PATCH | Mark single notification as read |
| `PATCH /notifications/read-all` | PATCH | Mark all as read |
| `GET /notifications/stream` | GET | SSE endpoint for real-time push |

---

### 4.10 Message Thread & Communication Log

**Goal:** A complete, channel-aware communication log for every enquiry.

#### 4.10.1 Improved Message Model
```prisma
model Message {
  id        String  @id @default(uuid())
  enquiryId String
  enquiry   Enquiry @relation(fields: [enquiryId], references: [id])

  channel       MessageChannel
  direction     MessageDirection
  classification MessageClassification @default(REAL_ENQUIRY)

  externalId String?
  from       String
  to         String?
  subject    String?
  content    String

  // Attachments
  hasAttachments Boolean @default(false)

  // Delivery status (for outbound)
  deliveryStatus String? // "sent", "delivered", "read", "failed"

  createdAt DateTime @default(now())

  attachments Attachment[]

  @@unique([channel, externalId])
}

model Attachment {
  id        String  @id @default(uuid())
  messageId String
  message   Message @relation(fields: [messageId], references: [id])

  fileName  String
  mimeType  String
  sizeBytes Int
  url       String  // S3 or local storage URL

  createdAt DateTime @default(now())
}
```

#### 4.10.2 Outbound Messaging
- **Email:** Use SendGrid/Mailgun API to send emails directly from the system.
  - Track delivery status via webhook callbacks.
  - Support reply-to threading (set In-Reply-To header).
- **WhatsApp:** Use WhatsApp Business API to send template messages or session messages.
  - Respect the 24-hour messaging window rule.
  - Use approved templates for messages outside the window.
- **Compose UI:** Simple message composer in the enquiry detail view:
  - Select channel (Email / WhatsApp).
  - Subject line (for email).
  - Rich text content.
  - Attach files (up to 10MB per attachment).

#### 4.10.3 API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /enquiry/:id/messages` | GET | List all messages for an enquiry (paginated) |
| `POST /enquiry/:id/messages` | POST | Send a new outbound message |
| `GET /messages/:id` | GET | Get single message with attachments |

---

### 4.11 Idempotency & Data Integrity

**Goal:** Ensure every webhook and API call is processed exactly once, even under retries or network failures.

#### 4.11.1 Current State (Keep & Improve)
- `IdempotencyKey` model, `IdempotencyGuard`, `IdempotencyMiddleware`, `IdempotencyInterceptor` — all exist.
- **Improvements:**
  - Add TTL cleanup — auto-delete idempotency keys older than 24 hours via a scheduled job.
  - Add index on `createdAt` for efficient cleanup queries.
  - Return `409 Conflict` with the cached response when a duplicate request is detected (currently may not be consistent).

#### 4.11.2 Transaction Safety
- All multi-step operations (ingestion, status change + automation scheduling) must use Prisma `$transaction`.
- The ingestion pipeline already uses `$transaction` — ensure the automation queue addition is also atomic (use a transactional outbox pattern if needed).

---

### 4.12 Authentication & Security Hardening

**Goal:** Production-grade security for the API and frontend.

#### 4.12.1 Auth Improvements
- **Refresh Tokens:** Implement a refresh token rotation flow:
  - Short-lived access token (15 minutes).
  - Long-lived refresh token (7 days), stored in HttpOnly cookie.
  - `POST /auth/refresh` endpoint.
  - Refresh token revocation on logout.
- **Rate Limiting:**
  - `@nestjs/throttler` on login endpoint (5 attempts per minute per IP).
  - Global rate limit on API (100 requests per minute per user).
- **CORS:** Strict CORS configuration allowing only the frontend origin.
- **Helmet:** Use `helmet` middleware for security headers.
- **Input Sanitization:** Ensure all DTOs use `class-validator` + `class-transformer` with `whitelist: true` and `forbidNonWhitelisted: true` in the global validation pipe.

#### 4.12.2 Webhook Security
- **Email webhook:** Validate the webhook signature from the provider.
- **WhatsApp webhook:** Validate `X-Hub-Signature-256` header from Meta.
- **IP whitelisting (optional):** Only accept webhook calls from known provider IPs.

---

### 4.13 Audit Trail & Observability

**Goal:** Full visibility into who did what and when — for compliance and debugging.

#### 4.13.1 Enhanced Timeline Events
Expand `EnquiryEventType`:
```prisma
enum EnquiryEventType {
  CREATED
  STATUS_CHANGED
  ASSIGNED
  REASSIGNED
  FOLLOWUP_SENT
  FOLLOWUP_SCHEDULED
  CUSTOMER_REPLIED
  MESSAGE_SENT
  MESSAGE_RECEIVED
  ESCALATED
  TAG_ADDED
  TAG_REMOVED
  CLASSIFICATION_OVERRIDDEN
  CONVERTED
  CLOSED
  REOPENED
}
```

#### 4.13.2 Structured Logging
- Use `nestjs-pino` (or `winston`) for structured JSON logging.
- Every log entry includes: `timestamp`, `requestId`, `userId`, `module`, `action`, `metadata`.
- Log levels: `error` for failures, `warn` for retries/fallbacks, `info` for business events, `debug` for developer troubleshooting.
- Correlation ID (`X-Request-Id` header) passed through all service calls for request tracing.

#### 4.13.3 Health Check Endpoint
- `GET /health` — returns status of:
  - Database connectivity.
  - Redis connectivity.
  - BullMQ queue status (queue length, active jobs).
- Used for uptime monitoring and deployment readiness checks.

---

### 4.14 API Design & Standards

**Goal:** Clean, consistent API contracts that are easy for the frontend and third parties to consume.

#### 4.14.1 Response Format
Standardize all API responses:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```
Error responses:
```json
{
  "success": false,
  "error": {
    "code": "ENQUIRY_NOT_FOUND",
    "message": "Enquiry with ID xyz not found",
    "statusCode": 404
  }
}
```

#### 4.14.2 Global Exception Filter
- Create a `GlobalExceptionFilter` that catches all exceptions and formats them consistently.
- Map Prisma errors (P2002 unique constraint, P2025 record not found) to user-friendly messages.

#### 4.14.3 API Versioning
- Prefix all routes with `/api/v1/` for future versioning.
- Use `app.setGlobalPrefix('api/v1')` in NestJS main.ts.

#### 4.14.4 Swagger / OpenAPI Documentation
- Use `@nestjs/swagger` to auto-generate API docs.
- Every endpoint should have:
  - Summary and description.
  - Request/response DTOs documented with `@ApiProperty()`.
  - Auth requirements documented.
  - Available at `GET /api/docs`.

---

### 4.15 Database Schema Improvements

**Goal:** Evolve the Prisma schema to support all V1 features cleanly.

#### 4.15.1 Schema Changes Summary
```prisma
// ── Updated User ──
model User {
  id           String    @id @default(uuid())
  userName     String    @unique
  email        String    @unique
  displayName  String
  password     String
  role         UserRole
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  assignedEnquiries Enquiry[]       @relation("EnquiryAssignment")
  notifications     Notification[]
}

enum UserRole {
  ADMIN
  MANAGER
  SALES
  OPS
}

// ── Updated Enquiry ──
model Enquiry {
  id     String        @id @default(uuid())
  name   String?
  email  String?
  phone  String?
  source EnquirySource
  status EnquiryStatus @default(NEW)
  tags   String[]      @default([])

  lostReason String?   // Reason when closed as lost

  version Int @default(1)

  lastCustomerReplyAt DateTime?
  firstResponseAt     DateTime?  // Track response time

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  assignedToId String?
  assignedTo   User?   @relation("EnquiryAssignment", fields: [assignedToId], references: [id])

  timeline EnquiryTimeline[]
  messages Message[]
}

enum EnquiryStatus {
  NEW
  OPEN
  IN_PROGRESS
  QUOTATION_SENT
  FOLLOW_UP
  CONVERTED
  CLOSED_LOST
}

// ── New: Automation Rule ──
model AutomationRule {
  id               String   @id @default(uuid())
  name             String
  description      String?
  isActive         Boolean  @default(true)
  triggerEvent     String
  triggerCondition Json?
  actionType       String
  actionConfig     Json
  delayMinutes     Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

// ── New: Notification ──
model Notification {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  type      String
  title     String
  body      String
  metadata  Json?
  isRead    Boolean   @default(false)
  readAt    DateTime?
  createdAt DateTime  @default(now())
}

// ── New: Attachment ──
model Attachment {
  id        String  @id @default(uuid())
  messageId String
  message   Message @relation(fields: [messageId], references: [id])
  fileName  String
  mimeType  String
  sizeBytes Int
  url       String
  createdAt DateTime @default(now())
}

// ── Updated Message ──
// Add: classification, to, hasAttachments, deliveryStatus, attachments relation
```

#### 4.15.2 Indexes for Performance
```prisma
// On Enquiry
@@index([status])
@@index([assignedToId])
@@index([source])
@@index([createdAt])
@@index([email])
@@index([phone])

// On Message
@@index([enquiryId, createdAt])

// On Notification
@@index([userId, isRead])
@@index([userId, createdAt])

// On IdempotencyKey
@@index([createdAt])  // For TTL cleanup
```

---

## 5. Post-V1 Roadmap (Brief)

> These are features planned for future versions. Listed here for reference only — **not in V1 scope**.

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Multi-Tenant / Multi-Organization** | Support multiple companies, each with their own users, enquiries, and settings |
| 2 | **Custom Pipeline Builder** | Drag-and-drop pipeline stages per organization (like Trello/HubSpot) |
| 3 | **WhatsApp Template Management** | Create, submit for approval, and manage WhatsApp message templates from the dashboard |
| 4 | **Advanced Analytics & Reporting** | Conversion funnels, source performance, team performance charts, export to CSV/PDF |
| 5 | **Customer Portal** | A public-facing portal where leads can check the status of their enquiry |
| 6 | **Email Sequence Builder** | Automated drip campaigns — send a sequence of emails over days/weeks |
| 7 | **CRM Integration** | Sync enquiries with HubSpot, Salesforce, Zoho CRM |
| 8 | **Payment & Invoicing** | Generate invoices and track payments directly from converted enquiries |
| 9 | **Mobile App (React Native)** | Dedicated mobile app for sales staff on the field |
| 10 | **Chatbot Integration** | Integrate a chatbot on the website that feeds into the enquiry pipeline |
| 11 | **Lead Scoring** | AI-based lead scoring to prioritize high-value enquiries |
| 12 | **Bulk Import/Export** | CSV/Excel import for migrating existing leads, bulk export for analysis |
| 13 | **Webhooks (Outgoing)** | Allow external systems to subscribe to enquiry events (e.g., Zapier integration) |
| 14 | **Custom Fields** | Allow admins to define custom fields on enquiries (industry, budget, location, etc.) |
| 15 | **SLA Configuration** | Configurable SLA policies per source or priority level with automated breach handling |
| 16 | **Two-Factor Authentication (2FA)** | TOTP-based 2FA for admin and manager accounts |
| 17 | **Activity Heatmap** | Visual heatmap showing peak enquiry hours/days for staffing optimization |
| 18 | **Duplicate Detection** | AI-powered detection of duplicate enquiries from the same customer across channels |
| 19 | **Voice Call Integration** | Click-to-call with call recording and transcription |
| 20 | **White-Label** | Custom branding, logos, and domains per organization |

---

> **Next Steps:** Start implementing V1 features in priority order:
> 1. Database schema migration (4.15)
> 2. CASL permissions setup (4.4)
> 3. Expanded FSM + side effects (4.3)
> 4. WhatsApp webhook + AI qualification (4.1 + 4.2)
> 5. Notification system (4.9)
> 6. Dashboard + Detail UI (4.6 + 4.7)
> 7. Automation engine expansion (4.8)
> 8. Security hardening (4.12)
> 9. API standards + Swagger docs (4.14)
