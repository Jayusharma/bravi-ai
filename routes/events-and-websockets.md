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

How to read this:
- **Client → Server**: Frontend calls `socket.emit(event, payload)` → Backend `@SubscribeMessage(event)` handler fires
- **Server → Client**: Backend calls `this.server.emit(...)` or `socket.to(room).emit(...)` → Frontend `sock.on(event, callback)` fires

---

### Client → Server Events
*(Frontend emits → Backend `@SubscribeMessage` handler receives)*

---

#### `chat:join`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `socket.emit('chat:join', { contactId })` — on mount when a contact is selected |
| **Backend receives** | `backend/src/modules/messaging/messaging.gateway.ts` | `@SubscribeMessage('chat:join') handleJoin()` — runs `client.join('contact:{contactId}')` |

**Payload:** `{ contactId: string }`

---

#### `chat:leave`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `socket.emit('chat:leave', { contactId })` — on unmount |
| **Backend receives** | `backend/src/modules/messaging/messaging.gateway.ts` | `@SubscribeMessage('chat:leave') handleLeave()` — runs `client.leave('contact:{contactId}')` |

**Payload:** `{ contactId: string }`

---

#### `enquiry:join`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `socket.emit('enquiry:join', { enquiryId })` — after thread loads |
| **Frontend emits** | `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | `socket.emit('enquiry:join', { enquiryId })` — on mount |
| **Backend receives** | `backend/src/modules/outbound/outbound.gateway.ts` | `@SubscribeMessage('enquiry:join') handleEnquiryJoin()` — runs `client.join('enquiry:{enquiryId}')` |

**Payload:** `{ enquiryId: string }`

---

#### `enquiry:leave`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `socket.emit('enquiry:leave', { enquiryId })` — on unmount |
| **Frontend emits** | `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | `socket.emit('enquiry:leave', { enquiryId })` — on unmount |
| **Backend receives** | `backend/src/modules/outbound/outbound.gateway.ts` | `@SubscribeMessage('enquiry:leave') handleEnquiryLeave()` — runs `client.leave('enquiry:{enquiryId}')` |

**Payload:** `{ enquiryId: string }`

---

#### `typing:start`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` (InlineComposer) | `socket.emit('typing:start', { enquiryId })` — debounced on keypress |
| **Backend receives** | `backend/src/modules/outbound/outbound.gateway.ts` | `@SubscribeMessage('typing:start') handleTypingStart()` — broadcasts `typing:update {isTyping:true}` to room excluding sender |

**Payload:** `{ enquiryId: string }`

---

#### `typing:stop`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Frontend emits** | `frontend/components/dashboard/Messaging/ChatView.tsx` (InlineComposer) | `socket.emit('typing:stop', { enquiryId })` — ~2s after last keystroke |
| **Backend receives** | `backend/src/modules/outbound/outbound.gateway.ts` | `@SubscribeMessage('typing:stop') handleTypingStop()` — broadcasts `typing:update {isTyping:false}` to room |

**Payload:** `{ enquiryId: string }`

---

### Server → Client Events
*(Backend emits → Frontend `sock.on(event, callback)` fires)*

---

#### `notification:new-message`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/messaging/messaging.gateway.ts` | `onInboundMessage()` — triggered by `@OnEvent('message.inbound.appended')` → `this.server.emit('notification:new-message', ...)` to ALL |
| **Backend emits** | `backend/src/modules/messaging/messaging.gateway.ts` | `onNewEnquiry()` — triggered by `@OnEvent('enquiry.created')` → `this.server.emit('notification:new-message', ...)` to ALL |
| **Frontend listens** | `frontend/app/(dashboard)/messaging/page.tsx` | `sock.on('notification:new-message', data => ...)` — shows `<MessageToast>`, increments unread badge for `data.contactId` |

**Payload:** `{ contactId: string, enquiryId: string, messagePreview: string, messageId: string }`
**Room target:** ALL connected clients

---

#### `contact-list:update`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/messaging/messaging.gateway.ts` | `broadcastContactListUpdate()` — called from `onInboundMessage()` and `onNewEnquiry()` → `this.server.emit('contact-list:update', { conversations })` to ALL |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ContactList.tsx` | `sock.on('contact-list:update', data => ...)` — replaces conversation list (skipped if search is active) |

**Payload:** `{ conversations: ConversationPreview[] }`
**Room target:** ALL connected clients

---

#### `chat:new-message`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/messaging/messaging.gateway.ts` | `onInboundMessage()` — triggered by `@OnEvent('message.inbound.appended')` → `this.server.to('contact:{contactId}').emit('chat:new-message', message)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('chat:new-message', msg => ...)` — appends inbound message to thread |

**Payload:** `ThreadMessage` object
**Room target:** `contact:{contactId}` room

---

#### `outbound:sent`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.processor.ts` | `updateAndEmit()` — on successful delivery → `eventEmitter.emit('outbound.sent', ...)` → `OutboundGateway.onSent()` → `this.server.to('enquiry:{id}').emit('outbound:sent', message)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('outbound:sent', msg => ...)` — appends sent message to thread |
| **Frontend listens** | `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | `sock.on('outbound:sent', msg => ...)` — adds to outbound history |
| **Frontend listens** | `frontend/components/outbound/OutboundHistory.tsx` | `sock.on('outbound:sent', msg => ...)` — adds to outbound history |
| **Frontend listens** | `frontend/components/outbound/OutboundComposer.tsx` | `sock.on('outbound:sent', msg => ...)` — clears composer after send |

**Payload:** `OutboundMessage` object
**Room target:** `enquiry:{enquiryId}` room

---

#### `outbound:delivery_updated`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.service.ts` | `updateDeliveryStatus()` — called when delivery webhook arrives → `eventEmitter.emit('outbound.delivery_updated', ...)` → `OutboundGateway.onDeliveryUpdated()` → `this.server.to('enquiry:{id}').emit('outbound:delivery_updated', ...)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('outbound:delivery_updated', data => ...)` — updates delivery badge on message |
| **Frontend listens** | `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | `sock.on('outbound:delivery_updated', data => ...)` — updates delivery badge |
| **Frontend listens** | `frontend/components/outbound/OutboundHistory.tsx` | `sock.on('outbound:delivery_updated', data => ...)` — updates delivery badge |

**Payload:** `{ messageId, deliveryStatus, deliveredAt?, readAt? }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `outbound:failed`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.processor.ts` | `onJobFailed()` + `updateAndEmit()` → `eventEmitter.emit('outbound.failed', ...)` → `OutboundGateway.onFailed()` → `this.server.to('enquiry:{id}').emit('outbound:failed', ...)` |
| **Frontend listens** | `frontend/components/outbound/OutboundHistory.tsx` | `sock.on('outbound:failed', data => ...)` — shows FAILED badge + retry button |

**Payload:** `{ messageId, error }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `message:reaction_updated`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `addReaction()` / `removeReaction()` → `eventEmitter.emit('message.reaction_updated', ...)` → `OutboundGateway.onReactionUpdated()` → `this.server.to('enquiry:{id}').emit('message:reaction_updated', ...)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('message:reaction_updated', data => ...)` — re-renders reaction row on message |

**Payload:** `{ messageId, reactions[] }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `message:deleted`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `softDeleteMessage()` → `eventEmitter.emit('message.deleted', ...)` → `OutboundGateway.onMessageDeleted()` → `this.server.to('enquiry:{id}').emit('message:deleted', ...)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('message:deleted', data => ...)` — marks message as deleted in thread |

**Payload:** `{ messageId }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `message:edited`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `editMessage()` → `eventEmitter.emit('message.edited', ...)` → `OutboundGateway.onMessageEdited()` → `this.server.to('enquiry:{id}').emit('message:edited', ...)` |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` | `sock.on('message:edited', data => ...)` — updates message content + shows edited timestamp |

**Payload:** `{ messageId, content, editedAt }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `typing:update`
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.gateway.ts` | `handleTypingStart()` / `handleTypingStop()` → `client.to('enquiry:{id}').emit('typing:update', { userId, isTyping })` (sent to room, excluding the sender's own socket) |
| **Frontend listens** | `frontend/components/dashboard/Messaging/ChatView.tsx` (InlineComposer) | `sock.on('typing:update', data => ...)` — shows/hides "{name} is typing..." indicator |

**Payload:** `{ userId: string, isTyping: boolean }`
**Room target:** `enquiry:{enquiryId}` room, excluding sender

---

#### `outbound:draft_saved` ⚠️ UNHANDLED ON FRONTEND
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `updateDraft()` → `eventEmitter.emit('outbound.draft_saved', ...)` → `OutboundGateway.onDraftSaved()` → `this.server.to('enquiry:{id}').emit('outbound:draft_saved', ...)` |
| **Frontend listens** | — | No `sock.on('outbound:draft_saved', ...)` found anywhere in the frontend |

**Payload:** `{ enquiryId, draft }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `outbound:retry_queued` ⚠️ UNHANDLED ON FRONTEND
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `retryMessage()` → `eventEmitter.emit('outbound.retry_queued', ...)` → `OutboundGateway.onRetryQueued()` → `this.server.to('enquiry:{id}').emit('outbound:retry_queued', ...)` |
| **Frontend listens** | — | No `sock.on('outbound:retry_queued', ...)` found anywhere in the frontend |

**Payload:** `{ enquiryId, messageId }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `outbound:attachment_added` ⚠️ UNHANDLED ON FRONTEND
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.controller.ts` | `uploadDraftAttachment()` → `eventEmitter.emit('outbound.attachment_added', ...)` → `OutboundGateway.onAttachmentAdded()` → `this.server.to('enquiry:{id}').emit('outbound:attachment_added', ...)` |
| **Frontend listens** | — | No `sock.on('outbound:attachment_added', ...)` found anywhere in the frontend |

**Payload:** `{ enquiryId, draftId, attachment }`
**Room target:** `enquiry:{enquiryId}` room

---

#### `presence:online` ⚠️ UNHANDLED ON FRONTEND
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.gateway.ts` | `handleConnection()` — on every new WS connection → upserts `UserPresence {isOnline:true}` → `this.server.emit('presence:online', { userId })` to ALL |
| **Frontend listens** | — | No `sock.on('presence:online', ...)` found anywhere in the frontend |

**Payload:** `{ userId: string }`
**Room target:** ALL connected clients

---

#### `presence:offline` ⚠️ UNHANDLED ON FRONTEND
| Side | File | Method / Handler |
|------|------|-----------------|
| **Backend emits** | `backend/src/modules/outbound/outbound.gateway.ts` | `handleDisconnect()` — on WS disconnect → upserts `UserPresence {isOnline:false}` → `this.server.emit('presence:offline', { userId })` to ALL |
| **Frontend listens** | — | No `sock.on('presence:offline', ...)` found anywhere in the frontend |

**Payload:** `{ userId: string }`
**Room target:** ALL connected clients

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















==================================================================

websockets functions and uses 

1. for client side methods :- 

sock.on('event', fn)      // add listener
sock.off('event', fn)     // remove specific listener
sock.once('event', fn)    // listen once then auto-remove
sock.emit('event', data)  // send event to backend
sock.connected            // boolean
sock.id                   // string, server-assigned
sock.disconnect()         // manually close connection


2. client and server simple connection 

  -> server emits = client.emit 
        
          @SubscribeMessage('message:send')
          handleMessage(
                @ConnectedSocket() client: Socket,
                @MessageBody() data: { text: string },
              ) {
                console.log('message received:', data.text);
            
                // send back to sender only
                client.emit('message:received', {
                  text: data.text,
                  from: 'server',
                });
              }   |
                  |
                  |
                  |
                  |
                  |
                  |
                  |
                  |
      
    -> client listens for emit = socket.on (message:received)



//all teh server ways to emit 
    
    // 1. to one specific client (the one who sent the message)
client.emit('event', data)

// 2. to everyone connected (all clients)
this.server.emit('event', data)

// 3. to everyone in a room
this.server.to('enquiry:123').emit('event', data)

// 4. to everyone in a room EXCEPT the sender
client.to('enquiry:123').emit('event', data)

// 5. to multiple rooms at once
this.server.to('enquiry:123').to('enquiry:456').emit('event', data)

// 6. to one specific socket by their socket id
this.server.to(socketId).emit('event', data)

// 7. to everyone EXCEPT one specific socket
client.broadcast.emit('event', data)


//all the client ways to emit 
// 1. send to backend (only option from frontend)
sock.emit('event', data)

// 2. send with acknowledgement — wait for backend to confirm
sock.emit('event', data, (ack) => {
  console.log(ack) // whatever backend returned
})

// 3. listen for event from backend
sock.on('event', (data) => {})

// 4. listen once then auto remove
sock.once('event', (data) => {})

// 5. remove listener
sock.off('event', handler)

// 6. disconnect manually
sock.disconnect()