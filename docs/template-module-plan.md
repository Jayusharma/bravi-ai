# Template Module — Final Build Plan

> Production-grade. Built in 6 steps, each one reviewable and compiling before
> the next starts. No vibe-coding — every step is small enough to read fully.

---

## What We're Building

One template system, two types:

| | INTERNAL | WHATSAPP |
|---|---|---|
| What | Quick-reply snippets | Meta-approved templates |
| Approval | None | Required (via Twilio Content API) |
| When usable | Within 24h session window | Anytime (opens a new window) |
| How sent | Free-form text (variables resolved locally) | ContentSid + ContentVariables via Twilio |
| Who creates | Admin/Manager | Admin/Manager |
| Variables in body | `[Customer Name]` → resolved to text before send | `[Customer Name]` → compiled to `{{1}}` positional |

---

## Schema (Step 1)

```prisma
model MessageTemplate {
  id              String              @id @default(uuid())
  type            TemplateType
  name            String              @unique  // slug: "follow_up_quotation" (lowercase, underscores — Meta requirement for WHATSAPP type)
  friendlyName    String              // "Follow-up after quotation"
  channel         MessageChannel      // WHATSAPP | EMAIL (existing enum)
  language        String              @default("en")

  // Content
  body            String              // raw: "Hi [Customer Name], about [Product]..."
  bodyCompiled    String?             // WHATSAPP only: "Hi {{1}}, about {{2}}..." — generated at submit
  subject         String?             // EMAIL internal templates only
  contentType     WaContentType       @default(TEXT)
  buttons         Json?               // CTA/QUICK_REPLY: [{type, text, url?, phone?}]
  headerMediaUrl  String?             // MEDIA type

  // WhatsApp approval lifecycle (all null for INTERNAL)
  contentSid      String?             @unique  // Twilio HXxxxx — set after Twilio create
  category        WaTemplateCategory?
  approvalStatus  WaApprovalStatus?
  rejectionReason String?
  sampleValues    Json?               // {"1": "Rahul", "2": "2BHK Sector 74"} — Meta requires

  isActive        Boolean             @default(true)
  createdById     String
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  variables       TemplateVariable[]

  @@index([type, channel, isActive])
  @@index([approvalStatus])
}

model TemplateVariable {
  id          String          @id @default(uuid())
  templateId  String
  template    MessageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  position    Int             // 1, 2, 3 — sequential, NO GAPS (Meta rejects gaps)
  label       String          // "Customer Name"
  source      String          // "contact.name" | "enquiry.intent" | "config.business_phone" | "user.name" | "manual"
  type        VariableType    // SYSTEM | CUSTOM

  @@unique([templateId, position])
  @@index([label])            // powers the autocomplete suggestion query
}

enum TemplateType {
  INTERNAL
  WHATSAPP
}

enum VariableType {
  SYSTEM
  CUSTOM
}

enum WaContentType {
  TEXT
  MEDIA
  CALL_TO_ACTION
  QUICK_REPLY
}

enum WaTemplateCategory {
  UTILITY
  MARKETING
  AUTHENTICATION
}

enum WaApprovalStatus {
  DRAFT
  PENDING
  APPROVED
  REJECTED
  PAUSED
  DISABLED
}
```

**Design decisions (locked):**
- ONE table for both types. A template is a template; `type` differentiates.
- Variables in their own table because the autocomplete query (`label startsWith`)
  must be fast and cross-template. JSON would require scanning every row.
- `body` stores the human-readable form with `[Label]` markers — this is what the
  admin edits. `bodyCompiled` with `{{1}}` positional is generated ONLY at
  submission time, because Meta requires sequential numbering with no gaps and
  numbering depends on order of appearance.
- Same variable used twice in a body = same position number (Meta allows reuse).
- After submission (PENDING or beyond), body and variables are FROZEN. Meta does
  not allow editing. "Edit" on a submitted template = duplicate as new DRAFT.

---

## System Variable Registry (Step 2 — code, not DB)

```typescript
// src/modules/template/template-variables.registry.ts

export interface SystemVariableDef {
  label: string;
  source: string;
  resolve: (ctx: VariableContext) => string | undefined;
}

export interface VariableContext {
  contact?: Contact & { channels: ContactChannel[] };
  enquiry?: Enquiry;
  user?: User;          // the sending agent
  config: (key: string) => string | undefined;  // SystemConfig getter
}

export const SYSTEM_VARIABLES: SystemVariableDef[] = [
  {
    label: 'Customer Name',
    source: 'contact.name',
    resolve: (ctx) => ctx.contact?.name,
  },
  {
    label: 'Customer Phone',
    source: 'contact.phone',
    resolve: (ctx) => ctx.contact?.channels.find(c => c.channel === 'WHATSAPP')?.identifier,
  },
  {
    label: 'Customer Email',
    source: 'contact.email',
    resolve: (ctx) => ctx.contact?.channels.find(c => c.channel === 'EMAIL')?.identifier,
  },
  {
    label: 'Product / Service',
    source: 'enquiry.intent',
    resolve: (ctx) => ctx.enquiry?.intent ?? undefined,
  },
  {
    label: 'Agent Name',
    source: 'user.name',
    resolve: (ctx) => ctx.user?.name,
  },
  {
    label: 'Business Name',
    source: 'config.business_name',
    resolve: (ctx) => ctx.config('business_name'),
  },
  {
    label: 'Business Phone',
    source: 'config.business_phone',
    resolve: (ctx) => ctx.config('business_phone'),
  },
];
```

Adding a new system variable later = one entry here. No migration.

---

## The 6 Build Steps

### STEP 1 — Schema migration + module skeleton
**What:** the two models + enums above. NestJS `template` module scaffold
(module, controller, service, DTOs — empty methods). CASL subject `messageTemplate`
added to permissions.
**Review:** schema diff + migration file + module wiring. ~15 min read.
**Done when:** migration runs clean, module loads, permissions seed.

### STEP 2 — Body parsing + variable engine
**What:** the core logic, pure functions, no HTTP:
- `parseBody(raw: string)` → extracts `[Label]` markers in order, dedupes repeats
- `classifyVariable(label)` → SYSTEM (found in registry) or CUSTOM
- `compileBody(raw, variables)` → generates `{{1}} {{2}}` positional form,
  sequential, reuse-aware (same label twice = same number)
- `resolveVariables(template, ctx)` → for INTERNAL send + auto-fill: runs each
  variable's resolver, returns `{ label, value | null }[]` (null = agent must fill)
- Unit tests for: gaps never produced, duplicate labels reuse numbers, unknown
  labels classify as CUSTOM, resolution falls back to null cleanly.
**Review:** one file of pure functions + tests. This is the heart — read it fully.
**Done when:** tests pass, you can explain compileBody line by line.

### STEP 3 — Template CRUD + variable suggestions (backend)
**What:**
- `POST /templates` — create (parses body, creates TemplateVariable rows,
  validates: WHATSAPP names lowercase+underscores, sequential positions)
- `GET /templates?type=&channel=&status=` — list with filters
- `GET /templates/:id` — detail with variables
- `PATCH /templates/:id` — update (REJECTED → allowed; PENDING/APPROVED → 403
  "duplicate to edit"; DRAFT → allowed, re-parses body)
- `DELETE /templates/:id` — soft (isActive=false) if ever sent; hard delete if never used
- `POST /templates/:id/duplicate` — copy as new DRAFT
- `GET /templates/variables/suggest?q=Fol` — distinct labels across
  TemplateVariable, startsWith match, returns {label, source, type}
- CASL guards: create/update/delete = ADMIN + MANAGER; read = all roles
**Review:** controller + service + DTOs. Check every endpoint's permission guard.
**Done when:** you can create/list/edit templates via API client (Postman/Thunder).

### STEP 4 — Internal template send path (the money feature)
**What:** agents use INTERNAL templates in the composer TODAY:
- `GET /templates/usable?contactId=&enquiryId=` — returns templates valid for this
  conversation's channel, with variables PRE-RESOLVED via the registry
  (auto-filled values included, manual ones flagged)
- Composer UI: template picker button → searchable list → select → variable
  fill panel (auto-filled editable, manual required) → live preview → "Insert"
  puts resolved text into the composer → normal OUTBOUND_SEND flow (free-form)
- 24h window check: `GET /enquiry/:id/session-status` → { active, expiresAt }
  computed from lastCustomerReplyAt + 24h. Composer shows badge:
  "Session active — 18h remaining" (green) / "Session expired" (red).
  V1 rule: if expired and channel is WHATSAPP, free-form send is BLOCKED in the
  composer with message "Use an approved WhatsApp template" (even before Step 5/6
  exist — better blocked than silently failed/charged).
**Review:** composer integration + the resolve flow. Test with a real contact.
**Done when:** agent picks template, variables auto-fill, message sends. SHIP THIS.

### STEP 5 — Twilio Content API integration (WhatsApp templates backend)
**What:**
- `TwilioContentService` (in outbound module or new `whatsapp-content` module —
  respects module boundaries, template module never calls Twilio directly):
  - `createContent(template)` → POST content.twilio.com/v1/Content with
    bodyCompiled + sample values → returns contentSid
  - `submitForApproval(contentSid, name, category)` → POST .../ApprovalRequests/whatsapp
  - `fetchApprovalStatus(contentSid)` → GET .../ApprovalRequests
- `POST /templates/:id/submit` — orchestrates: validate (samples present, body
  compiled, name format) → createContent → submitForApproval → set PENDING +
  store contentSid → freeze body/variables
- Approval polling: BullMQ repeatable job every 5 min → fetch status for all
  PENDING → update APPROVED / REJECTED (+reason) / PAUSED / DISABLED →
  emit notification to admins (reuse existing notification toast events)
- Error handling: Twilio API failure → keep DRAFT, surface error to admin, retry
  allowed. Never leave a template stuck in a half-submitted state.
**Review:** the Twilio service + submit flow + cron. Check error paths carefully.
**Done when:** you create a template in your UI, see it appear in Twilio Console,
status flows PENDING → APPROVED (test with a simple UTILITY template).

### STEP 6 — WhatsApp template send + admin UI polish
**What:**
- Send path: composer in expired-window mode shows ONLY APPROVED WhatsApp
  templates → agent selects → fill panel (auto-fill + manual) → backend maps
  values to positions ({"1": "Rahul", ...}) → send via Twilio with ContentSid +
  ContentVariables (NOT body) → normal delivery tracking (the message flows
  through the existing outbound pipeline; adapter detects contentSid and switches
  API call shape)
- The sent message stores the RESOLVED text in ConversationMessage.body so the
  thread shows what the customer actually received
- Admin template list page: status badges (DRAFT grey / PENDING yellow /
  APPROVED green / REJECTED red + reason / PAUSED orange), filters, duplicate
  action, submit action
- Template creation page: name, language, category (UTILITY default), content
  type, body editor with [+ Insert Field] dropdown (system vars + custom-with-
  autocomplete via the suggest endpoint), sample values inputs (auto-shown per
  variable), live phone-mockup preview using sample values
**Review:** the send-path adapter change + the two admin pages.
**Done when:** full loop works: create → submit → approved → agent sends to an
expired-window contact → customer receives → new 24h window opens → free-form
unlocked.

---

## Production Rules (non-negotiable)

1. **Sequential variable numbering, no gaps, ever.** compileBody is the only place
   numbering happens; it is tested for this property.
2. **Frozen after submission.** PENDING/APPROVED templates: body, variables,
   category immutable. Duplicate-to-edit only.
3. **Template module never calls Twilio directly.** It calls TwilioContentService
   (outbound layer). Module boundaries hold.
4. **ConversationMessage.body always stores resolved text** — the thread shows
   what the customer saw, never `{{1}}` placeholders.
5. **Window check is server-side too.** Composer blocking is UX; the gateway
   OUTBOUND_SEND validation (already specced) rejects free-form WhatsApp sends on
   expired windows regardless of client state.
6. **Approval polling failures are silent-safe.** Cron errors log + retry next
   cycle; never crash, never flip statuses without a confirmed Twilio response.
7. **Every endpoint has a CASL guard.** Listed per-endpoint in Step 3.

---

## What's Deliberately NOT in This Module (don't let scope creep in)

- Template usage analytics (sends, response rates) → V2
- Template gallery / pre-built starters → V1 polish AFTER module works
- A/B testing templates → V2
- Email template rich HTML builder → V2 (internal EMAIL templates are plain text
  + subject for now)
- Template versioning tables → not needed; duplicate-as-new-draft covers it