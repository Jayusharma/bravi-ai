# Events & WebSockets

Complete real-time system map for Enquiry Hub.

---

## Connection Architecture

```
Frontend (Next.js)                     Backend (NestJS 11)
──────────────────                     ──────────────────
                                       
getSocket()                            Socket.IO server
  └─ fetchToken()                        namespace: / (default)
       └─ GET /api/socket ──────────►  reads access_token HttpOnly cookie
            ◄── { token } ────────────  returns JWT
  └─ io(BACKEND_URL, {                   
       auth: { token }                 ┌─ MessagingGateway
     })                    ──────────► │    handleConnection: verify JWT
                                       └─ OutboundGateway
                                            handleConnection: verify JWT
                                       ⚠️  BOTH gateways share namespace /
                                          Each runs its own handleConnection
                                          per connection (JWT verified twice)
```

**Frontend file:** `frontend/lib/socket.ts`
- Singleton pattern: one shared socket instance across the app
- 10 reconnect attempts, delay 1–5s
- `joinedRooms: Set<string>` — auto-rejoins rooms after reconnect
- `joinEnquiryRoom(enquiryId)` / `leaveEnquiryRoom(enquiryId)` helpers

**Backend Redis scaling:** `backend/src/adapters/redis-io.adapter.ts`
- Uses `@socket.io/redis-adapter` with two ioredis clients (pub + sub)
- Ensures `socket.to(room).emit()` reaches clients on any server instance
- Without this, horizontal scaling would silently drop messages to 50% of users

---

## Room System

| Room Name | Join Event | Leave Event | Purpose |
|-----------|-----------|-------------|---------|
| `contact:{contactId}` | `chat:join` | `chat:leave` | Inbound message fan-out per contact |
| `enquiry:{enquiryId}` | `enquiry:join` | `enquiry:leave` | Outbound delivery updates per enquiry |

---

## Complete WebSocket Event Registry

### Client → Server (emit from frontend, subscribe on backend)

| Event | Backend Handler | Payload | Effect |
|-------|----------------|---------|--------|
| `chat:join` | `MessagingGateway.handleJoin()` | `{ contactId: string }` | Client joins `contact:{contactId}` room |
| `chat:leave` | `MessagingGateway.handleLeave()` | `{ contactId: string }` | Client leaves `contact:{contactId}` room |
| `enquiry:join` | `OutboundGateway.handleEnquiryJoin()` | `{ enquiryId: string }` | Client joins `enquiry:{enquiryId}` room |
| `enquiry:leave` | `OutboundGateway.handleEnquiryLeave()` | `{ enquiryId: string }` | Client leaves `enquiry:{enquiryId}` room |
| `typing:start` | `OutboundGateway.handleTypingStart()` | `{ enquiryId: string }` | Broadcasts `typing:update` to room (excluding sender) |
| `typing:stop` | `OutboundGateway.handleTypingStop()` | `{ enquiryId: string }` | Broadcasts `typing:update` to room (excluding sender) |

### Server → Client (emit from backend, listen on frontend)

| Event | Gateway | Room Target | Payload | Frontend Listeners |
|-------|---------|-------------|---------|-------------------|
| `chat:new-message` | MessagingGateway | `contact:{contactId}` | ThreadMessage | `ChatView.tsx` |
| `notification:new-message` | MessagingGateway | ALL | `{ contactId, enquiryId }` | `messaging/page.tsx` (toast + badge) |
| `contact-list:update` | MessagingGateway | ALL | `{ conversations: ConversationPreview[] }` | `ContactList.tsx`, `messaging/page.tsx` |
| `outbound:draft_saved` | OutboundGateway | `enquiry:{enquiryId}` | `{ draft }` | ⚠️ UNHANDLED — emitted but no frontend listener found |
| `outbound:sent` | OutboundGateway | `enquiry:{enquiryId}` | OutboundMessage | `EnquiryDetailClient.tsx`, `ChatView.tsx`, `OutboundHistory.tsx` |
| `outbound:failed` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId, error }` | `OutboundHistory.tsx` |
| `outbound:retry_queued` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId }` | ⚠️ UNHANDLED — emitted but no frontend listener found |
| `outbound:delivery_updated` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId, deliveryStatus, deliveredAt?, readAt? }` | `EnquiryDetailClient.tsx`, `ChatView.tsx`, `OutboundHistory.tsx` |
| `outbound:attachment_added` | OutboundGateway | `enquiry:{enquiryId}` | `{ draftId, attachment }` | ⚠️ UNHANDLED — emitted but no frontend listener found |
| `message:reaction_updated` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId, reactions[] }` | `ChatView.tsx` |
| `message:deleted` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId }` | `ChatView.tsx` |
| `message:edited` | OutboundGateway | `enquiry:{enquiryId}` | `{ messageId, content, editedAt }` | `ChatView.tsx` |
| `typing:update` | OutboundGateway | `enquiry:{enquiryId}` (excl. sender) | `{ userId, isTyping: boolean }` | `ChatView.tsx` (InlineComposer) |
| `presence:online` | OutboundGateway | ALL | `{ userId }` | ⚠️ UNHANDLED — emitted but no frontend listener found |
| `presence:offline` | OutboundGateway | ALL | `{ userId }` | ⚠️ UNHANDLED — emitted but no frontend listener found |

---

## ASCII Flow Diagrams

### Inbound Message Flow (WhatsApp → Contact List update)

```
Twilio ──POST /api/v1/webhook/whatsapp──► WebhookController
                                              │
                                              ▼
                                         IngestionService.ingest()
                                              │
                              ┌───────────────┼───────────────────┐
                              │               │                   │
                         PATH A          PATH B              PATH C/D
                    (known contact +  (closed ≤30d)       (new contact or
                     open enquiry)    reopen enquiry        new enquiry)
                    append message         │                    │
                              │            │                    ▼
                              │            │           qualification queue
                              │            │           ──────────────────
                              │            │           QualificationProcessor
                              │            │           → QualificationService
                              │            │           → Gemini AI classify
                              │            │           → emit enquiry.qualified
                              │            │                    │
                              │            │           EnquiryService.handleQualified()
                              │            │           → create Enquiry
                              │            │           → emit enquiry.created
                              │            │                    │
                              ▼            ▼                    ▼
                       emit message.inbound.appended     MessagingGateway
                              │                          onNewEnquiry()
                              ▼                               │
                       MessagingGateway                       ▼
                       onInboundMessage()           socket.emit('notification:new-message')
                              │                    socket ALL
                              ▼
              socket.emit('chat:new-message')    ◄── room: contact:{contactId}
              socket.emit('notification:new-message') ◄── ALL
              broadcastContactListUpdate() → socket.emit('contact-list:update') ◄── ALL
```

### Outbound Send Flow (Draft → Delivery Status)

```
User clicks Send
      │
      ▼
ChatView / OutboundComposer
  POST /outbound/drafts/:draftId/send
      │
      ▼
OutboundController.sendDraft()
  → OutboundService.sendDraft()
      │
      ▼
OutboundService enqueues job
  queue: OUTBOUND_QUEUE
  job: outbound:whatsapp  OR  outbound:email
      │
      ▼
OutboundProcessor.process()
  → ChannelRouterService.route()
      │
      ├── WhatsAppAdapter → Twilio API
      │      │
      │      └── success → updateAndEmit(SENT)
      │              → emit outbound.sent (EventEmitter2)
      │              → OutboundGateway.onSent()
      │              → socket.emit('outbound:sent') ◄── room: enquiry:{id}
      │
      └── EmailAdapter → SendGrid API
             │
             └── success → updateAndEmit(SENT)
                     → same flow as above

Later: Delivery webhook arrives
  POST /outbound/webhooks/whatsapp/delivery
      │
      ▼
OutboundService.updateDeliveryStatus()
  → emit outbound.delivery_updated
  → OutboundGateway.onDeliveryUpdated()
  → socket.emit('outbound:delivery_updated') ◄── room: enquiry:{id}
```

### Typing Indicator Flow

```
User types in InlineComposer (ChatView.tsx)
      │
      ▼
debounced onInput handler
  socket.emit('typing:start', { enquiryId })
      │
      ▼
OutboundGateway.handleTypingStart()
  socket.to('enquiry:{id}').emit('typing:update', { userId, isTyping: true })
      │                          (excluding the sender's socket)
      ▼
Other users in same enquiry room
  receive 'typing:update' → show typing indicator

After 2s of no input:
  socket.emit('typing:stop', { enquiryId })
  → OutboundGateway.handleTypingStop()
  → socket.to('enquiry:{id}').emit('typing:update', { userId, isTyping: false })
```

### User Presence Flow

```
User connects WebSocket
      │
      ▼
OutboundGateway.handleConnection()
  → upsert UserPresence { isOnline: true }
  → socket.emit('presence:online', { userId }) ◄── ALL
      │
      ▼  (⚠️ no frontend listener currently)

User disconnects
      │
      ▼
OutboundGateway.handleDisconnect()
  → upsert UserPresence { isOnline: false }
  → socket.emit('presence:offline', { userId }) ◄── ALL
      │
      ▼  (⚠️ no frontend listener currently)
```

---

## Gateway Map

| Gateway Class | File | Namespace | Handles Connection? | Key Responsibilities |
|--------------|------|-----------|---------------------|---------------------|
| `MessagingGateway` | `backend/src/modules/messaging/messaging.gateway.ts` | `/` (default) | ✅ (JWT verify) | Inbound message broadcast, contact-list updates, notification toasts |
| `OutboundGateway` | `backend/src/modules/outbound/outbound.gateway.ts` | `/` (default) | ✅ (JWT verify + UserPresence) | Outbound delivery tracking, typing indicators, reactions, edit/delete, presence |

⚠️ Both gateways share the default namespace `/`. Socket.IO merges them, but both `handleConnection` handlers fire for every client connection — JWT is verified twice.

---

## Frontend Socket Hook Summary

| Component / File | Events Listened | Events Emitted |
|-----------------|----------------|----------------|
| `frontend/app/(dashboard)/messaging/page.tsx` | `notification:new-message`, `contact-list:update` | — |
| `frontend/components/dashboard/Messaging/ContactList.tsx` | `contact-list:update` | — |
| `frontend/components/dashboard/Messaging/ChatView.tsx` | `chat:new-message`, `outbound:sent`, `outbound:delivery_updated`, `message:reaction_updated`, `message:deleted`, `message:edited`, `typing:update` | `chat:join`, `chat:leave`, `enquiry:join`, `typing:start`, `typing:stop` |
| `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | `outbound:sent`, `outbound:delivery_updated` | `enquiry:join`, `enquiry:leave` |
| `frontend/components/outbound/OutboundComposer.tsx` | `outbound:sent` | — |
| `frontend/components/outbound/OutboundHistory.tsx` | `outbound:sent`, `outbound:delivery_updated`, `outbound:failed` | — |
| `frontend/app/(dashboard)/playground/page.tsx` | `new-message` (non-production event) | `send-message` (non-production event) |
