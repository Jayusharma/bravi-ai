# API Registry

Complete map of every backend REST endpoint, BullMQ queue, and internal event bus event.
All paths are relative to the global prefix `/api/v1` (backend runs on port 3001).

---

## Auth

| Method | Path | Public? | CASL | Body | Response |
|--------|------|---------|------|------|----------|
| POST | `/auth/login` | ✅ @Public | — | `{ userName, password }` (LoginDto) | `{ user, permissions[], token }` |
| GET | `/auth/me` | ❌ JWT | — | — | `{ id, userName, email, displayName, role, permissions[] }` |

**Frontend caller:** `frontend/services/auth/login.service.ts` — `login()`, `getCurrentUser()`

---

## Enquiry

| Method | Path | Public? | CASL | Body / Query | Response |
|--------|------|---------|------|--------------|----------|
| GET | `/enquiry` | ❌ JWT | read:enquiry | query: `status, assignedTo, search, page, limit` (InboxQueryDto) | `{ data: Enquiry[], pagination }` |
| GET | `/enquiry/stats` | ❌ JWT | read:enquiry | — | stats object |
| GET | `/enquiry/:id` | ❌ JWT | read:enquiry | — | Enquiry detail |
| POST | `/enquiry` | ❌ JWT | create:enquiry | CreateEnquiryDto | Enquiry |
| PATCH | `/enquiry/:id/status` | ❌ JWT | update:enquiry | `{ status }` (UpdateStatusDto) | Enquiry |
| PATCH | `/enquiry/:id/assign` | ❌ JWT | assign:enquiry | `{ userId }` (AssignDto) | Enquiry |
| PATCH | `/enquiry/:id/tags` | ❌ JWT | update:enquiry | `{ tags: string[] }` | Enquiry |
| POST | `/enquiry/:id/messages` | ❌ JWT | create:message | `{ content, channel }` | ConversationMessage |
| GET | `/enquiry/:id/messages` | ❌ JWT | read:message | query: `limit, offset` | `{ data: Message[], total }` |
| POST | `/enquiry/:id/notes` | ❌ JWT | create:internalnote | `{ content }` | InternalNote |
| PATCH | `/enquiry/qualfiy` | ✅ @Public | — | — | (test endpoint, typo in route) |

**Frontend callers:** `frontend/services/messaging/enquiry.service.ts`

---

## Conversations (Messaging)

| Method | Path | Public? | CASL | Query | Response |
|--------|------|---------|------|-------|----------|
| GET | `/conversations` | ❌ JWT | read:contact | `search, page, limit` | `{ data: ConversationPreview[], pagination }` |
| GET | `/conversations/:contactId/thread` | ❌ JWT | read:messages | — | `{ contact, enquiries: EnquiryThread[] }` |

**Frontend callers:** `frontend/services/dashboard/conversation.services.ts` — `getConversations()`, `getConversationThread(contactId)`

---

## Outbound

### Drafts

| Method | Path | Public? | CASL | Body | Response |
|--------|------|---------|------|------|----------|
| POST | `/outbound/enquiries/:enquiryId/drafts` | ❌ JWT | create:outbounddraft | `{ channel, subject?, body? }` | OutboundDraft |
| GET | `/outbound/enquiries/:enquiryId/draft` | ❌ JWT | read:outbounddraft | — | OutboundDraft \| null |
| PATCH | `/outbound/drafts/:draftId` | ❌ JWT | update:outbounddraft | `{ channel?, subject?, body? }` | OutboundDraft |
| DELETE | `/outbound/drafts/:draftId` | ❌ JWT | delete:outbounddraft | — | 204 |

### Attachments

| Method | Path | Public? | CASL | Body | Response |
|--------|------|---------|------|------|----------|
| POST | `/outbound/drafts/:draftId/attachments` | ❌ JWT | update:outbounddraft | `multipart/form-data` (field: `file`) | `{ attachmentId, cdnUrl, kind, fileName, fileSize }` |
| DELETE | `/outbound/drafts/:draftId/attachments/:attachmentId` | ❌ JWT | update:outbounddraft | — | 204 |

**Frontend upload:** `frontend/lib/upload.ts` — `uploadAttachment()` uses XHR (not fetch) for progress tracking. Token fetched from `GET /api/socket` (HttpOnly cookie relay).

### Send

| Method | Path | Public? | CASL | Body | Response |
|--------|------|---------|------|------|----------|
| POST | `/outbound/drafts/:draftId/send` | ❌ JWT | create:conversationmessage | `{ recipientOverride? }` | OutboundMessage |

### Message History

| Method | Path | Public? | CASL | Query | Response |
|--------|------|---------|------|-------|----------|
| GET | `/outbound/enquiries/:enquiryId/messages` | ❌ JWT | read:conversationmessage | `limit, offset` | `{ data: OutboundMessage[], total }` |

### Message Actions

| Method | Path | Public? | CASL | Body | Response |
|--------|------|---------|------|------|----------|
| POST | `/outbound/messages/:messageId/retry` | ❌ JWT | update:conversationmessage | — | `{ queued: boolean }` |
| POST | `/outbound/messages/:messageId/reactions` | ❌ JWT | create:conversationmessage | `{ emoji }` | 201 |
| DELETE | `/outbound/messages/:messageId/reactions/:emoji` | ❌ JWT | delete:conversationmessage | — | 204 |
| PATCH | `/outbound/messages/:messageId/delete` | ❌ JWT | delete:conversationmessage | — | 200 (soft delete) |
| PATCH | `/outbound/messages/:messageId/edit` | ❌ JWT | update:conversationmessage | `{ content }` | OutboundMessage (15-min window, OUTBOUND only) |

### Delivery Webhooks (External callbacks)

| Method | Path | Public? | Notes |
|--------|------|---------|-------|
| POST | `/outbound/webhooks/whatsapp/delivery` | ✅ @Public | Twilio delivery status callback |
| POST | `/outbound/webhooks/email/delivery` | ✅ @Public | SendGrid delivery event callback |

**Frontend callers:** `frontend/services/messaging/outbound.service.ts`

---

## Contact

| Method | Path | Public? | CASL | Notes |
|--------|------|---------|------|-------|
| GET | `/contact` | ❌ JWT | read:contact | List all contacts |
| GET | `/contact/:id` | ❌ JWT | read:contact | Contact detail |
| PATCH | `/contact/:id` | ❌ JWT | update:contact | Update contact fields |
| GET | `/contact/:contactId/enquiries` | ❌ JWT | read:enquiry | All enquiries for a contact |

---

## Inbound Webhooks

These receive messages from external channels. Protected by `IdempotencyInterceptor` (deduplication via `IdempotencyKey` table).

| Method | Path | Public? | Notes |
|--------|------|---------|-------|
| POST | `/webhook/whatsapp` | ✅ @Public | Twilio WhatsApp webhook (IdempotencyGuard + Interceptor) |
| POST | `/webhook/email` | ✅ @Public | SendGrid inbound email (FileInterceptor + IdempotencyInterceptor) |

**File:** `backend/src/modules/webhooks/webhook.controller.ts`

---

## Users

| Method | Path | Public? | Notes |
|--------|------|---------|-------|
| GET | `/users` | ❌ JWT | List all users |
| GET | `/users/:id` | ❌ JWT | User detail |
| POST | `/users` | ✅ @Public | Create user |
| PATCH | `/users/:id` | ❌ JWT | Update user |
| PATCH | `/users/:id/password` | ❌ JWT | Change password |
| DELETE | `/users/:id` | ❌ JWT | Soft delete |

---

## Permissions (CASL / RBAC)

Roles: `ADMIN`, `MANAGER`, `SALES`, `OPS` (from `UserRole` enum in Prisma schema).

| Method | Path | Public? | CASL | Notes |
|--------|------|---------|------|-------|
| POST | `/permissions/create` | ❌ JWT | — | Create a permission definition |
| POST | `/permissions/subjects` | ❌ JWT | — | Create permission subjects |
| GET | `/permissions` | ❌ JWT | read:permission | List all permissions |
| GET | `/permissions/:id` | ❌ JWT | read:permission | Permission detail |
| PATCH | `/permissions/:id` | ❌ JWT | update:permission | Update permission |
| DELETE | `/permissions/:id` | ❌ JWT | delete:permission | Delete permission |
| POST | `/permissions/roles/assign` | ❌ JWT | — | Assign role permission |
| POST | `/permissions/roles/bulk-assign` | ❌ JWT | create:permission | Bulk assign permissions to a role |
| GET | `/permissions/roles/all` | ❌ JWT | read:permission | All role→permission assignments |
| GET | `/permissions/roles/:role` | ❌ JWT | read:permission | Assignments for a role |
| GET | `/permissions/roles/assignment/:id` | ❌ JWT | read:permission | Single assignment |
| PATCH | `/permissions/roles/assignment/:id` | ❌ JWT | update:permission | Update assignment |
| DELETE | `/permissions/roles/assignment/:id` | ❌ JWT | delete:permission | Remove assignment |
| DELETE | `/permissions/roles/:role/clear` | ❌ JWT | delete:permission | Clear all permissions for a role |

**Note:** `CaslGuard` is commented out at class level on `PermissionController` — individual routes rely on method-level decorators only.

**Frontend callers:** `frontend/services/permission/` (called from `/permissions` page)

---

## BullMQ Queues

### `qualification` queue
- **Defined in:** `backend/src/modules/ingestion/ingestion.service.ts`
- **Job name:** `qualify`
- **Payload:** `{ inboundMessageId: string }`
- **Retries:** 3 attempts, exponential backoff starting at 2000ms
- **Processor:** `backend/src/modules/qualification/qualification.processor.ts` → calls `QualificationService.qualify()`
- **Flow:** InboundMessage → AI classifier (Gemini) → `QualificationStatus` (REAL_ENQUIRY / SPAM / NEEDS_REVIEW) → emits `enquiry.qualified` if real lead

### `OUTBOUND_QUEUE` queue
- **Defined in:** `backend/src/modules/outbound/outbound.service.ts`
- **Job names:** `outbound:email`, `outbound:whatsapp`
- **Payload:** `{ messageId, channel, to, content, subject?, attachments? }`
- **Retries:** 3 attempts, exponential backoff starting at 2000ms
- **Processor:** `backend/src/modules/outbound/outbound.processor.ts` → routes to `ChannelRouterService` → `EmailAdapter` / `WhatsAppAdapter`

---

## Internal EventEmitter2 Events

These are NestJS-internal events (not WebSocket). They cross module boundaries without direct imports.

| Event Name | Emitter | Listener | Payload |
|-----------|---------|----------|---------|
| `message.outbound` | `EnquiryService.sendMessage()`, `EnquiryService.addOutboundMessage()`, `OutboundService.retryMessage()` | `OutboundService.handleOutbound()` | `{ messageId, channel, to, content, subject?, attachments? }` |
| `message.inbound.appended` | `IngestionService.appendToExistingEnquiry()`, `IngestionService.reopenClosedEnquiry()`, `EnquiryService.handleQualified()` | `MessagingGateway.onInboundMessage()` | `{ contactId, enquiryId, message }` |
| `enquiry.qualified` | `QualificationService.qualify()` (only when `REAL_ENQUIRY`) | `EnquiryService.handleQualified()` | `{ inboundMessageId, contactId, intent, urgency, priority, extractedData }` |
| `enquiry.created` | `EnquiryService.handleQualified()` | `MessagingGateway.onNewEnquiry()` | `{ enquiryId, contactId }` |
| `outbound.sent` | `OutboundProcessor.updateAndEmit()` | `OutboundGateway.onSent()` | `{ enquiryId, messageId, ... }` |
| `outbound.failed` | `OutboundProcessor.onJobFailed()`, `OutboundProcessor.updateAndEmit()` | `OutboundGateway.onFailed()` | `{ enquiryId, messageId, error }` |
| `outbound.retry_queued` | `OutboundController.retryMessage()` | `OutboundGateway.onRetryQueued()` | `{ enquiryId, messageId }` |
| `outbound.delivery_updated` | `OutboundService.updateDeliveryStatus()` | `OutboundGateway.onDeliveryUpdated()` | `{ enquiryId, messageId, deliveryStatus, deliveredAt?, readAt? }` |
| `outbound.draft_saved` | `OutboundController.updateDraft()` | `OutboundGateway.onDraftSaved()` | `{ enquiryId, draft }` |
| `outbound.attachment_added` | `OutboundController.uploadDraftAttachment()` | `OutboundGateway.onAttachmentAdded()` | `{ enquiryId, draftId, attachment }` |
| `message.reaction_updated` | `OutboundController.addReaction()`, `OutboundController.removeReaction()` | `OutboundGateway.onReactionUpdated()` | `{ enquiryId, messageId, reactions[] }` |
| `message.deleted` | `OutboundController.softDeleteMessage()` | `OutboundGateway.onMessageDeleted()` | `{ enquiryId, messageId }` |
| `message.edited` | `OutboundController.editMessage()` | `OutboundGateway.onMessageEdited()` | `{ enquiryId, messageId, content, editedAt }` |

---

## Frontend API Token Relay

The frontend has two Next.js API routes (not backend):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/socket` | Reads `access_token` HttpOnly cookie → returns `{ token }` for WebSocket auth and XHR uploads |
| POST | `/api/logout` | Clears `access_token` cookie |

**Files:** `frontend/app/api/socket/route.ts`, `frontend/app/api/logout/route.ts`
