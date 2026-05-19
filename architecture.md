# ARCHITECTURE.md — Enquiry Hub

> Reference this file when building any new module. It defines every contract,
> boundary, pattern, and decision. Building without reading this = wrong code.

---

## Data Flow — The Full Pipeline

```
INBOUND
──────────────────────────────────────────────────────────────
Twilio/SendGrid webhook
  → WebhookController (normalize raw payload)
  → WebhookService (route by channel)
  → IngestionService
      ├── find-or-create Contact (by channel+identifier)
      ├── find-or-create ContactChannel
      ├── compute contentFingerprint (SHA-256 dedup)
      └── create InboundMessage { status: PENDING }
  → BullMQ: enqueue 'qualification' job
  → QualificationProcessor
      ├── Layer 1: RuleStrategy (blacklist/whitelist/regex/domain)
      │     result: SPAM | REAL_ENQUIRY | continue
      ├── Layer 2: AIStrategy (Gemini) — only if Layer 1 uncertain
      │     extracts: intent, urgency, priority, contactName, budgetSignal
      │     result: REAL_ENQUIRY | SPAM | NEEDS_REVIEW
      └── create QualificationResult + update InboundMessage.status
  → event: 'enquiry.qualified'
  → EnquiryService
      ├── find open Enquiry for this Contact (status NOT IN [CONVERTED, CLOSED_LOST])
      ├── if exists: append ConversationMessage (INBOUND)
      └── if not: create Enquiry + first ConversationMessage
  → MessagingGateway.emit('new_message') → frontend realtime

OUTBOUND
──────────────────────────────────────────────────────────────
Staff sends reply via UI
  → EnquiryController.addMessage()
  → EnquiryService
      ├── resolve Contact primary channel
      ├── create ConversationMessage { direction: OUTBOUND, status: PENDING }
      ├── write EnquiryTimeline { type: MESSAGE_SENT }
      └── emit('message.outbound', { messageId, channel, to, content })
  → OutboundService @OnEvent('message.outbound')
  → ChannelRouterService → WhatsAppAdapter | EmailAdapter
  → update ConversationMessage { status: SENT, externalId }
  → delivery webhook callback → DELIVERED → READ

AUTOMATION
──────────────────────────────────────────────────────────────
EnquiryService (on status → QUOTATION_SENT)
  → BullMQ: enqueue 'automation' job { enquiryId, delay: 24h }
  → automation.worker.ts (separate process)
      ├── re-fetch enquiry (validate still QUOTATION_SENT)
      ├── idempotency check (EnquiryTimeline FOLLOWUP_SENT exists?)
      ├── send follow-up via template
      └── write EnquiryTimeline { type: FOLLOWUP_SENT, createdBy: 'SYSTEM' }
```

---

## Module Boundaries — What Each Module Owns

| Module | Owns | Never Does |
|---|---|---|
| `webhooks` | Normalize raw payload → IncomingMessageDto | Business logic, DB writes |
| `Ingestion` | Contact resolution, InboundMessage creation, fingerprint | Qualification, sending |
| `qualification` | Rule engine, AI call, QualificationResult | Create Enquiry, send messages |
| `enquiry` | Enquiry CRUD, state machine, conversation thread | Call Twilio/SendGrid directly |
| `outbound` | Send via adapters, update delivery status | Know about Enquiry state/rules |
| `contact` | Contact + channel CRUD, merge logic | Qualification, messaging |
| `automation` | BullMQ job execution (separate process) | HTTP, NestJS DI |
| `messaging` | WebSocket gateway, realtime push | REST, business logic |
| `casl` | Compute abilities from role+permissions | Auth, routing |
| `permission` | Permission + RolePermission CRUD | Compute abilities |
| `user` | User CRUD, password hashing | Auth tokens |
| `auth` | Token generation, JWT strategy | User management |

---

## Schema Contracts — Critical Invariants

### Contact Identity
```
Contact (person)
  └── ContactChannel[] (how to reach them)
        ├── WHATSAPP + "+919876543210"
        └── EMAIL + "user@example.com"

Rule: ONE Contact per unique (channel, identifier) pair
Rule: isPrimary=true = preferred outbound channel
Rule: When resolving inbound — find ContactChannel first, then Contact
Rule: Merge two Contacts → reassign all channels, enquiries, messages to winner
```

### Enquiry Threading
```
Rule: One Contact → max ONE open Enquiry at a time
      open = status NOT IN (CONVERTED, CLOSED_LOST)
Rule: New message from known contact → find open enquiry → append
Rule: No open enquiry → create new Enquiry + first ConversationMessage
Rule: Enquiry.version used for optimistic concurrency on status updates
Rule: lastActivityAt updated on EVERY action (message, status change, note)
Rule: lastCustomerReplyAt updated only on INBOUND messages
Rule: firstResponseAt set only once, on first OUTBOUND message
```

### Enquiry State Machine
```
NEW ──→ OPEN ──→ IN_PROGRESS ──→ AWAITING_CUSTOMER ──→ QUOTATION_SENT
                                                              │
                                          ┌───────────────────┤
                                          ▼                   ▼
                                      FOLLOW_UP          CONVERTED
                                          │
                                          ▼
                                      CLOSED_LOST
                                      
STALE: any status with no lastActivityAt update in N days (configured)
REOPENED: CLOSED_LOST → OPEN (allowed, write REOPENED timeline event)

Rule: EVERY status change → write EnquiryTimeline { fromStatus, toStatus, createdBy }
Rule: Use enquiry.state.ts for transition validation — never raw status update
```

### Qualification Pipeline Contracts
```
Rule: QualificationResult is 1:1 with InboundMessage (unique constraint)
Rule: Layer order is always: Rule → AI → Manual. Never skip Rule layer.
Rule: AI only called if Rule layer returns uncertain (no clear SPAM/REAL)
Rule: Track aiInputTokens + aiOutputTokens + estimatedCostUsd on every AI call
Rule: hitCount + lastHitAt updated on QualificationRule when it fires
Rule: contentFingerprint = SHA-256(channel + from + body) — dedup across channels
```

### ConversationMessage Delivery Lifecycle
```
PENDING → SENT (provider accepted) → DELIVERED (device received) → READ (opened)
       → FAILED (provider rejected)

Rule: externalId = provider's message ID (wamid_xxx for WhatsApp, Message-ID for email)
Rule: Set deliveredAt on DELIVERED, readAt on READ
Rule: FAILED messages must not be retried automatically — require manual action
```

---

## Modules To Build Next

### 1. Template Module (build first — everything else depends on it)

**Schema:**
```prisma
model MessageTemplate {
  id          String         @id @default(uuid())
  name        String
  channel     MessageChannel
  subject     String?                    // email only
  body        String                     // supports {{variableName}} placeholders
  variables   String[]       @default([]) // declared variable names
  category    String?                    // "followup" | "quotation" | "welcome" etc
  isActive    Boolean        @default(true)
  createdBy   String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  @@index([channel, isActive])
  @@index([category])
}
```

**Service methods:**
```typescript
create(dto: CreateTemplateDto, userId: string): Promise<MessageTemplate>
findAll(channel?: MessageChannel): Promise<MessageTemplate[]>
findOne(id: string): Promise<MessageTemplate>
update(id: string, dto: UpdateTemplateDto): Promise<MessageTemplate>
delete(id: string): Promise<void>
// Key method — renders template with actual values
render(templateId: string, variables: Record<string, string>): Promise<{ subject?: string; body: string }>
```

**Render logic:**
```typescript
// Replace {{variableName}} with values, throw if required variable missing
render(template: MessageTemplate, vars: Record<string, string>): string {
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!vars[key]) throw new BadRequestException(`Missing variable: ${key}`);
    return vars[key];
  });
}
```

**CASL subjects to add:** `messageTemplate`

---

### 2. Bulk Messaging Module

**Flow:**
```
POST /bulk-message
  body: { templateId, contactIds[], variables: Record<string,string>, scheduledAt? }

BulkMessageService
  ├── validate template exists + active
  ├── validate all contacts have channel matching template.channel
  ├── render template for each contact (contact-specific variables: contactName, etc)
  ├── create BulkMessageJob record (track progress)
  └── enqueue N BullMQ jobs { enquiryId, templateId, renderedBody, to }

Queue: 'bulk-outbound'
Worker: bulk-outbound.worker.ts (separate process)
  ├── rate limit: max 10/second for WhatsApp, 100/second for email
  ├── emit('message.outbound') for each → reuse existing outbound pipeline
  └── update BulkMessageJob.sentCount, failedCount on completion
```

**Schema:**
```prisma
model BulkMessageJob {
  id           String         @id @default(uuid())
  templateId   String
  channel      MessageChannel
  totalCount   Int
  sentCount    Int            @default(0)
  failedCount  Int            @default(0)
  status       String         // PENDING | RUNNING | COMPLETED | FAILED
  createdBy    String
  createdAt    DateTime       @default(now())
  completedAt  DateTime?
}
```

---

### 3. Automation Rules Engine

**Design: trigger/action pairs stored in DB, evaluated by worker**

```prisma
model AutomationRule {
  id          String   @id @default(uuid())
  name        String
  isActive    Boolean  @default(true)
  trigger     Json     // { type: 'STATUS_CHANGED', toStatus: 'QUOTATION_SENT' }
                       // { type: 'NO_REPLY_AFTER', hours: 24, fromStatus: 'AWAITING_CUSTOMER' }
                       // { type: 'ENQUIRY_CREATED', intent: 'BULK_ORDER' }
  action      Json     // { type: 'SEND_TEMPLATE', templateId: '...' }
                       // { type: 'ASSIGN_TO', userId: '...' }
                       // { type: 'SET_STATUS', status: 'FOLLOW_UP' }
                       // { type: 'ADD_TAG', tag: 'urgent' }
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isActive])
}
```

**Trigger evaluation (automation.worker.ts):**
```typescript
// On every enquiry state change event:
// 1. Load all active AutomationRules
// 2. Match trigger against event (type + conditions)
// 3. Execute action
// 4. Write EnquiryTimeline { type: AUTO_ASSIGNED | FOLLOWUP_SCHEDULED | etc }
// 5. Idempotency: check timeline before executing — never fire same rule twice per enquiry
```

---

### 4. Follow-up Scheduler (extends automation worker)

**Current state:** `automation.worker.ts` has a placeholder that checks `QUOTATION_SENT` only.

**Production design:**
```typescript
// When AutomationRule trigger fires (e.g. status → QUOTATION_SENT):
// Schedule a delayed BullMQ job with the rule's delay config
await automationQueue.add('followup', { enquiryId, ruleId }, { delay: hours * 3600000 });

// Worker on job execution:
// 1. Re-fetch enquiry — validate status still matches (CRITICAL — state may have changed)
// 2. Check idempotency (EnquiryTimeline: FOLLOWUP_SENT for this ruleId)
// 3. Resolve contact primary channel
// 4. Render template with contact variables
// 5. emit('message.outbound') → reuse outbound pipeline
// 6. Write EnquiryTimeline { type: FOLLOWUP_SENT, metadata: { ruleId } }
```

---

### 5. AI Reply Assist

**Endpoint:** `POST /enquiry/:id/ai-suggest-reply`

**Service logic:**
```typescript
// 1. Fetch last N messages from ConversationMessage (N=10, most recent)
// 2. Build context: contact name, enquiry intent, conversation history
// 3. Gemini prompt:
//    "You are a sales assistant. Context: [intent, contact name]
//     Conversation: [last 10 messages]
//     Write 3 reply options. Be professional, concise. JSON array."
// 4. Return suggestions[] to frontend
// 5. Track tokens/cost on QualificationResult or new AiUsageLog model
// Frontend: show suggestions above composer, one click to insert
```

---

### 6. Analytics Module

**Queries needed (Prisma raw or aggregation):**
```typescript
// Conversion funnel
enquiryCountByStatus(): Promise<Record<EnquiryStatus, number>>

// Response time (SLA tracking)
avgFirstResponseTime(from: Date, to: Date): Promise<number> // ms
// = AVG(firstResponseAt - createdAt) WHERE firstResponseAt IS NOT NULL

// Channel performance
enquiriesByChannel(from: Date, to: Date): Promise<Record<MessageChannel, number>>

// AI qualification accuracy
qualificationAccuracy(): Promise<{ aiCorrect: number; aiOverridden: number }>
// = count(wasOverridden=true) / count(sentToAI=true)

// Agent performance
responseTimeByUser(): Promise<Array<{ userId: string; avgMs: number; count: number }>>

// Intent distribution
enquiriesByIntent(): Promise<Record<EnquiryIntent, number>>
```

**All analytics endpoints:** ADMIN + MANAGER only (CASL check)

---

## Production Checklist (before go-live)

- [ ] Twilio webhook signature validation (`X-Twilio-Signature` header check)
- [ ] `@nestjs/throttler` rate limiting on all public/webhook routes
- [ ] Wire email adapter in `channel-router.service.ts` (currently commented out)
- [ ] Implement `OutboundDraft` controller (schema exists, no API yet)
- [ ] File upload flow for `MessageAttachment` (schema exists, no upload endpoint)
- [ ] Redis persistence config (AOF or RDB — default is in-memory only)
- [ ] BullMQ dead letter queue for failed jobs
- [ ] Structured logging (replace Logger with pino/winston + correlation IDs)
- [ ] Health check endpoint (`/health` — check DB, Redis, queue connectivity)
- [ ] Prisma connection pooling config (PgBouncer or pg Pool size tuning)
- [ ] Environment-based config validation (Joi schema on startup)
- [ ] CORS origin whitelist (currently probably wide open)

---

## Frontend Patterns

**API calls:** Always use `lib/api-client.ts` (typed Axios with auth interceptor). Never use raw fetch.

**Endpoints:** Always add to `lib/endpoints.ts` first. Never hardcode URLs in components.

**Permissions:** Use `<PermissionGate action="update" subject="enquiry">` to hide UI elements.
Never hide UI with `user.role === 'ADMIN'` — always go through CASL.

**Realtime:** Socket events from `lib/socket.ts`. Listen in component, clean up on unmount.
```typescript
useEffect(() => {
  socket.on('new_message', handler);
  return () => socket.off('new_message', handler);
}, []);
```

**State:** Zustand for global (auth, user). Local useState for component UI state.
Don't put server data in Zustand — fetch on demand.