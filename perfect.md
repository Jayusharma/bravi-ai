# WebSocket Event Architecture — APPEND TO ARCHITECTURE.md

> **This is the single source of truth for every real-time event in the system.**
> Every event listed here with its emitter, handler, payload, and flow.
> If an event isn't in this doc, it doesn't exist. If a file emits something
> not in this doc, it's a bug.

---

## Event Constants — One File, One Truth

All event names live in `socket-events.ts`. Never hardcode an event string
anywhere else. Import from here or it's wrong.

```typescript
// socket-events.ts — COMPLETE LIST (V1 final)

// ── Room Management ──────────────────────────────
export const CONTACT_JOIN = 'contact:join';
export const CONTACT_LEAVE = 'contact:leave';

// ── Outbound Send (client → server) ─────────────
export const OUTBOUND_SEND = 'outbound:send';

// ── Message Lifecycle (server → client) ──────────
export const MESSAGE_NEW = 'chat:new-message';         // inbound AND outbound
export const OUTBOUND_SENT = 'outbound:sent';           // PENDING → SENT
export const OUTBOUND_FAILED = 'outbound:failed';       // PENDING → FAILED
export const OUTBOUND_RETRY_QUEUED = 'outbound:retry_queued';
export const OUTBOUND_DELIVERY_UPDATED = 'outbound:delivery_updated'; // DELIVERED / READ

// ── Message Mutations (server → client) ──────────
export const MESSAGE_DELETED = 'message:deleted';
export const MESSAGE_EDITED = 'message:edited';
export const MESSAGE_REACTION_UPDATED = 'message:reaction_updated';

// ── Typing (bidirectional) ───────────────────────
export const TYPING_START = 'typing:start';             // client → server
export const TYPING_STOP = 'typing:stop';               // client → server
export const TYPING_UPDATE = 'typing:update';           // server → client (room)
export const CONVERSATION_TYPING = 'conversation:typing'; // server → client (global/sidebar)

// ── Sidebar Deltas (server → client, global) ────
export const CONVERSATION_UPDATED = 'conversation:updated';
export const CONVERSATION_NEW = 'conversation:new';
export const CONTACT_UPDATED = 'contact:updated';
export const NOTIFICATION_NEW_MESSAGE = 'notification:new-message';

// ── Presence (server → client, global) ───────────
export const PRESENCE_ONLINE = 'presence:online';
export const PRESENCE_OFFLINE = 'presence:offline';

// ── System ───────────────────────────────────────
export const AUTH_ERROR = 'auth-error';

// ── DELETED (remove from codebase) ───────────────
// CONTACT_LIST_UPDATE = 'contact-list:update'  ← DEAD CODE, remove
```

---

## Connection Lifecycle

### Connect
```
Frontend: SocketContext.tsx
  → socket.connect() on dashboard layout mount
  → sends JWT in handshake auth: { token }

Backend: app.gateway.ts handleConnection()
  → validate JWT
  → if invalid → emit 'auth-error', disconnect
  → if valid → store socket in connection map
  → emit PRESENCE_ONLINE { userId, userName } to all sockets
  → log connection

Frontend: SocketContext.tsx
  → on 'connect' → set connectionStatus = 'connected'
  → hide reconnecting banner
```

### Disconnect
```
Frontend: SocketContext.tsx
  → on 'disconnect' → set connectionStatus = 'disconnected'
  → show "Reconnecting…" banner

Backend: app.gateway.ts handleDisconnect()
  → remove socket from connection map
  → remove from all rooms
  → emit PRESENCE_OFFLINE { userId, userName } to all sockets
  → update UserPresence in DB (lastSeenAt)
```

### Reconnect
```
Frontend: SocketContext.tsx
  → Socket.IO auto-reconnects (built-in)
  → on 'connect' after reconnect:
      1. set connectionStatus = 'connected'
      2. hide banner
      3. re-join any active contact room (if a thread was open)
      4. RESYNC: call GET /conversations to refresh sidebar list
      5. RESYNC: if thread open, call GET /enquiry/:id/messages
         since last rendered messageId to fill the gap
      6. resume normal delta patching
```

### Auth Error
```
Backend: app.gateway.ts
  → JWT expired or invalid during handshake or mid-session
  → emit 'auth-error' { reason: 'TOKEN_EXPIRED' | 'INVALID_TOKEN' }
  → disconnect socket

Frontend: SocketContext.tsx
  → on 'auth-error' → redirect to /auth/login
  → clear local auth state
```

---

## Room Management

### contact:join
```
Flow:
  Frontend: ChatView.tsx (on mount / when user opens a conversation)
    → socket.emit(CONTACT_JOIN, { contactId })

  Backend: app.gateway.ts @SubscribeMessage(CONTACT_JOIN)
    → validate user has permission to view this contact
    → socket.join(`contact:${contactId}`)
    → (optional) log who's in the room for debugging

  Result: this socket now receives all room-scoped events for this contact
          (MESSAGE_NEW, OUTBOUND_SENT, TYPING_UPDATE, etc.)
```

### contact:leave
```
Flow:
  Frontend: ChatView.tsx (on unmount / when user closes the conversation)
    → socket.emit(CONTACT_LEAVE, { contactId })
    → clean up ALL room-scoped listeners (message:new, typing, etc.)

  Backend: app.gateway.ts @SubscribeMessage(CONTACT_LEAVE)
    → socket.leave(`contact:${contactId}`)

  Result: socket stops receiving room-scoped events for this contact.

  RULE: EVERY join MUST have a matching leave on unmount. No exceptions.
        Use useEffect cleanup:
        useEffect(() => {
          socket.emit(CONTACT_JOIN, { contactId });
          // ... set up listeners ...
          return () => {
            socket.emit(CONTACT_LEAVE, { contactId });
            // ... remove listeners ...
          };
        }, [contactId]);
```

---

## Flow 1 — Inbound Message (customer sends to business)

This is the most important flow. A customer sends a WhatsApp/Email and every
agent sees it in real time.

```
STEP 1 — Webhook receives message
  File: webhooks.controller.ts → webhooks.service.ts
  Action: normalize payload, route to IngestionService
  Socket: NONE (no events yet — this is raw HTTP)

STEP 2 — Ingestion creates InboundMessage
  File: ingestion.service.ts
  Action: find/create Contact + ContactChannel, create InboundMessage { status: PENDING },
          compute contentFingerprint, enqueue 'qualification' job
  Socket: NONE (message not confirmed real yet — don't notify anyone)

STEP 3 — Qualification processes
  File: qualification.processor.ts
  Action: Rule layer → AI layer (if needed) → create QualificationResult,
          update InboundMessage status
  Socket: NONE (still internal processing)

STEP 4 — Enquiry created/updated + ConversationMessage appended
  File: enquiry.service.ts (on 'enquiry.qualified' event)
  Action: find open Enquiry or create new one, append ConversationMessage
          (direction: INBOUND), update lastActivityAt + lastCustomerReplyAt
  Socket: THIS IS WHERE ALL EVENTS FIRE ↓

STEP 4a — New message in thread (room-scoped)
  Emitter: enquiry.service.ts → app.event-handler.ts
  Event: MESSAGE_NEW ('chat:new-message')
  Target: server.to(`contact:${contactId}`)  ← only agents with thread open
  Payload: {
    message: full ConversationMessage object,
    contactId
  }
  Frontend listener: ChatView.tsx
    → append message to thread
    → scroll to bottom (or show "↓ new messages" pill if scrolled up)
    → call mark-as-read if thread is visible (document.visibilityState === 'visible')

STEP 4b — Sidebar update (global)
  Emitter: enquiry.service.ts → app.event-handler.ts
  Event: CONVERSATION_UPDATED ('conversation:updated')
  Target: server.emit() ← all connected sockets (V1 flat visibility)
  Payload: {
    enquiryId,
    contactId,
    lastMessagePreview: body.substring(0, 80),
    lastActivityAt: new Date(),
    status: enquiry.status,
    unreadDelta: +1,
    updatedField: 'NEW_INBOUND'
  }
  Frontend listener: ContactList.tsx
    → find conversation by enquiryId, patch preview + timestamp + unread
    → debounced re-sort (200ms)

STEP 4c — Global notification (toast + badge)
  Emitter: enquiry.service.ts → app.event-handler.ts
  Event: NOTIFICATION_NEW_MESSAGE ('notification:new-message')
  Target: server.emit() ← all connected sockets
  Payload: {
    contactId,
    contactName,
    messagePreview: body.substring(0, 80),
    channel: 'WHATSAPP' | 'EMAIL',
    enquiryId
  }
  Frontend listener: SocketContext.tsx (global provider)
    → show toast notification (slide-in with contact name + preview)
    → increment nav badge count
    → play notification sound (if user has it enabled)
    → toast has "View" button → navigate to /messaging?contact=${contactId}

STEP 4d — New enquiry card (only if this created a NEW enquiry)
  Emitter: enquiry.service.ts → app.event-handler.ts
  Event: CONVERSATION_NEW ('conversation:new')
  Target: server.emit()
  Payload: full conversation card object (same shape as /conversations list item)
  Frontend listener: ContactList.tsx
    → insert new card at top of list
    → (do NOT emit conversation:updated for the same event — one or the other)
```

---

## Flow 2 — Outbound Message (agent sends to customer)

```
STEP 1 — Agent hits send
  File: Composer.tsx
  Action: emit OUTBOUND_SEND to server
  Socket event: OUTBOUND_SEND ('outbound:send')
  Payload: {
    contactId,
    enquiryId,
    body,
    channel: 'WHATSAPP' | 'EMAIL',
    attachments?: [],
    tempId: crypto.randomUUID()   ← for dedup (see step 2b)
  }
  Local (sender only): immediately render optimistic bubble in ChatView
    → status: PENDING, grey single tick
    → use tempId as temporary key

STEP 2 — Server creates ConversationMessage + queues send
  File: app.gateway.ts → enquiry.service.ts
  Action: create ConversationMessage { direction: OUTBOUND, status: PENDING },
          write EnquiryTimeline, update lastActivityAt,
          enqueue to outbound queue

STEP 2a — Acknowledge sender
  Emitter: app.gateway.ts (callback/ack on the OUTBOUND_SEND event)
  Target: sender socket only (Socket.IO acknowledgement)
  Payload: { success: true, messageId: realId, tempId }
  Frontend: Composer.tsx / ChatView.tsx
    → replace tempId with real messageId on the optimistic bubble
    → now the bubble can receive status updates by messageId

STEP 2b — Broadcast to OTHER agents in thread (THE FIX)
  Emitter: app.event-handler.ts
  Event: MESSAGE_NEW ('chat:new-message')
  Target: server.to(`contact:${contactId}`)  ← entire room
  Payload: { message: full ConversationMessage, contactId }
  Frontend: ChatView.tsx
    → on receiving MESSAGE_NEW, check: did I send this? (match by messageId
       against already-rendered optimistic bubble)
    → if YES: skip (already rendered, just update messageId from ack)
    → if NO: append the new bubble (this is another agent's message)

STEP 2c — Sidebar update (global)
  Emitter: app.event-handler.ts
  Event: CONVERSATION_UPDATED
  Target: server.emit()
  Payload: { ...same shape, unreadDelta: 0, updatedField: 'OUTBOUND_SENT' }
  Frontend: ContactList.tsx
    → patch preview with sent message text, re-sort by lastActivityAt

STEP 3 — Provider dispatches, confirms send
  File: outbound queue worker → WhatsAppAdapter / EmailAdapter
  Action: send via Twilio/SendGrid, get externalId back

STEP 3a — Sent confirmation
  Emitter: app.event-handler.ts (on 'outbound.sent' internal event)
  Event: OUTBOUND_SENT ('outbound:sent')
  Target: server.to(`contact:${contactId}`)
  Payload: { messageId, status: 'SENT', externalId }
  Frontend: ChatView.tsx
    → find bubble by messageId, update tick: ✓ sent (grey single tick)

STEP 3b — OR: send failed
  Emitter: app.event-handler.ts (on 'outbound.failed' internal event)
  Event: OUTBOUND_FAILED ('outbound:failed')
  Target: server.to(`contact:${contactId}`)
  Payload: { messageId, status: 'FAILED', error: string }
  Frontend: ChatView.tsx
    → find bubble by messageId, show ✗ failed + "Tap to retry" button
    → retry button emits OUTBOUND_SEND again with same content

STEP 4 — Delivery webhook (later, async)
  File: webhooks.controller.ts → outbound.service.ts
  Action: Twilio/SendGrid delivery callback, update ConversationMessage status

  Emitter: app.event-handler.ts (on 'outbound.delivery_updated')
  Event: OUTBOUND_DELIVERY_UPDATED ('outbound:delivery_updated')
  Target: server.to(`contact:${contactId}`)
  Payload: { messageId, status: 'DELIVERED' | 'READ', deliveredAt?, readAt? }
  Frontend: ChatView.tsx
    → DELIVERED: ✓✓ double tick (grey)
    → READ: ✓✓ double tick (blue) — this is the CUSTOMER read receipt
```

---

## Flow 3 — Typing

```
Agent starts typing:
  File: Composer.tsx
  Action: on input change, throttled (1 emit per 2 seconds max)
  Socket: emit TYPING_START ('typing:start')
  Payload: { contactId }

  Backend: app.gateway.ts @SubscribeMessage(TYPING_START)
    → extract userId + userName from JWT
    → emit to contact room:
        TYPING_UPDATE ('typing:update')
        Target: server.to(`contact:${contactId}`).except(sender socket)
        Payload: { contactId, userId, userName, isTyping: true }
    → emit globally for sidebar:
        CONVERSATION_TYPING ('conversation:typing')
        Target: server.emit() (all sockets except sender)
        Payload: { contactId, userId, userName, isTyping: true }

  Frontend (thread): ChatView.tsx
    → on TYPING_UPDATE where isTyping: true
    → show "Jay is typing…" indicator below last message
    → auto-clear after 3s if no new typing event (safety timeout)
    → style: agent typing = blue/muted color text

  Frontend (sidebar): ContactList.tsx
    → on CONVERSATION_TYPING where isTyping: true
    → find contact card, replace preview text with "Jay is typing…"
    → style: blue/muted (distinct from customer message preview)
    → auto-clear after 3s, restore original preview text

Agent stops typing (sends message, clears input, or 3s idle):
  File: Composer.tsx
  Action: emit TYPING_STOP ('typing:stop')
  Payload: { contactId }

  Backend: same as above but isTyping: false
    → TYPING_UPDATE { isTyping: false } to room
    → CONVERSATION_TYPING { isTyping: false } global

  Frontend: clear typing indicators in both ChatView and ContactList.

Customer typing (V2 — do not build now):
  WhatsApp BSP sometimes sends presence events but it's unreliable.
  When built: same TYPING_UPDATE event, but with isCustomer: true flag.
  Frontend: green color indicator instead of blue. Note as V2 seam.
```

---

## Flow 4 — Delete

### Agent deletes own message
```
  Frontend: ChatView.tsx (context menu / long-press on own outbound message)
    → call REST API: DELETE /enquiry/:enquiryId/messages/:messageId
    → optimistic: immediately show "🚫 This message was deleted" locally

  Backend: enquiry.controller.ts → enquiry.service.ts
    → Guards (all server-side):
        1. CASL: user has 'delete' on 'conversationMessage' → 403 if not
        2. message.createdByUserId === currentUser.id → 403 if not
        3. message.direction === 'OUTBOUND' → 403 if inbound
    → set isDeleted=true, deletedAt=now(), deletedByUserId, deletedReason=AGENT_DELETED
    → emit to room:
        MESSAGE_DELETED ('message:deleted')
        Target: server.to(`contact:${contactId}`)
        Payload: { messageId, deletedReason: 'AGENT_DELETED', deletedByUserId }
    → emit globally:
        CONVERSATION_UPDATED
        Payload: { ...delta, updatedField: 'MESSAGE_DELETED',
                   lastMessagePreview: recalculate from latest non-deleted message }

  Frontend: ChatView.tsx
    → on MESSAGE_DELETED: find bubble by messageId
    → regular agent: replace content with "🚫 This message was deleted"
    → admin: show "🚫 This message was deleted" + reveal original on hover
              + show "Deleted by Jay at 3:42 PM"
    → never remove the bubble — keep position in thread

  Frontend: ContactList.tsx
    → on CONVERSATION_UPDATED with MESSAGE_DELETED: update preview text
```

### Customer revokes message (WhatsApp "delete for everyone")
```
  Backend: webhooks.controller.ts
    → WhatsApp sends revoke webhook with original wamid
    → Route to enquiry.service.ts

  Case A — message exists as ConversationMessage:
    → find by externalId = wamid
    → set isDeleted=true, deletedReason=CUSTOMER_REVOKED, deletedByUserId=null
    → emit MESSAGE_DELETED to room { messageId, deletedReason: 'CUSTOMER_REVOKED' }
    → emit CONVERSATION_UPDATED globally

  Case B — still in queue as InboundMessage only:
    → find InboundMessage by externalId = wamid
    → set isRevoked=true
    → qualification worker checks isRevoked before creating ConversationMessage
    → if revoked: create ConversationMessage with isDeleted=true pre-set

  Case C — revoke arrives BEFORE original message (race):
    → no InboundMessage found for this wamid
    → store pending revoke using IdempotencyKey pattern:
        key = `revoke:${wamid}`, value = timestamp
    → when original message arrives in ingestion, check for pending revoke
    → if found: set isRevoked=true on InboundMessage immediately

  Frontend: same as agent delete — "🚫 Customer deleted this message"
    → admin can still see original content on hover
```

---

## Flow 5 — Mark as Read (team watermark)

```
  Frontend: ChatView.tsx
    → on thread open (mount + messages rendered):
        call PATCH /enquiry/:id/read { lastReadMessageId: <newest rendered ID> }
    → on new message arriving while thread is visible:
        call same endpoint with the new message ID
    → ONLY call if document.visibilityState === 'visible'
        (tab is active — don't mark read on a hidden tab)

  Backend: enquiry.controller.ts → enquiry.service.ts
    → find message by lastReadMessageId, get its createdAt
    → if createdAt > enquiry.lastReadAt: update enquiry.lastReadAt = createdAt
      (watermark only moves forward — never backward)
    → calculate how many messages were just marked read (the delta)
    → emit CONVERSATION_UPDATED
        Target: server.emit()
        Payload: { enquiryId, unreadDelta: -N, updatedField: 'MARKED_READ' }

  Frontend: ContactList.tsx
    → on CONVERSATION_UPDATED with MARKED_READ:
        reduce unread count by N on that conversation card
        if unread hits 0, remove the badge
```

---

## Flow 6 — Presence

```
  Agent comes online:
    Backend: app.gateway.ts handleConnection()
      → after JWT validation
      → emit PRESENCE_ONLINE to all sockets
      Payload: { userId, userName, connectedAt }

    Frontend: SocketContext.tsx (global)
      → update local online-users map
      → presence dots turn green wherever this agent appears

  Agent goes offline:
    Backend: app.gateway.ts handleDisconnect()
      → emit PRESENCE_OFFLINE to all sockets
      Payload: { userId, userName, lastSeenAt }
      → update UserPresence.lastSeenAt in DB

    Frontend: SocketContext.tsx (global)
      → update local online-users map
      → presence dots turn grey
```

---

## Flow 7 — Sidebar Contact Detail Update

```
  When contact details change (name, tags, channel added/removed):
    Backend: contact.service.ts (on update)
      → emit CONTACT_UPDATED
      Target: server.emit()
      Payload: { contactId, updatedFields: { name?, tags?, channels? } }

    Frontend: ContactList.tsx
      → patch the contact card with updated fields
      → no re-sort needed (detail change doesn't affect order)
```

---

## Frontend Listener Map — Which Component Listens To What

### SocketContext.tsx (global — always active on dashboard)
```
Listens to:
  - connect / disconnect / reconnect  → connection status + reconnect resync
  - auth-error                         → redirect to login
  - NOTIFICATION_NEW_MESSAGE           → toast + nav badge + sound
  - CONVERSATION_UPDATED               → forward to ContactList (via context or event bus)
  - CONVERSATION_NEW                   → forward to ContactList
  - CONVERSATION_TYPING                → forward to ContactList
  - CONTACT_UPDATED                    → forward to ContactList
  - PRESENCE_ONLINE / PRESENCE_OFFLINE → online users map
```

### ContactList.tsx (sidebar — active on messaging page)
```
Listens to (via SocketContext or direct):
  - CONVERSATION_UPDATED   → patch card, debounced re-sort (200ms)
  - CONVERSATION_NEW        → insert new card at top
  - CONVERSATION_TYPING     → show/clear "Jay is typing…" on card
  - CONTACT_UPDATED         → patch contact details on card
```

### ChatView.tsx (thread — active when a conversation is open)
```
On mount:
  - emit CONTACT_JOIN { contactId }
  - set up listeners below
  - fetch messages via HTTP
  - call mark-as-read

Listens to:
  - MESSAGE_NEW              → append bubble (dedup if own outbound)
  - OUTBOUND_SENT            → update tick to ✓ sent
  - OUTBOUND_FAILED          → show ✗ failed + retry
  - OUTBOUND_RETRY_QUEUED    → show "retrying…" state
  - OUTBOUND_DELIVERY_UPDATED → update tick to ✓✓ or blue ✓✓
  - TYPING_UPDATE            → show/clear typing indicator
  - MESSAGE_DELETED          → replace bubble with deleted indicator
  - MESSAGE_EDITED           → update bubble content + "edited" label
  - MESSAGE_REACTION_UPDATED → update reactions on bubble

On unmount:
  - emit CONTACT_LEAVE { contactId }
  - remove ALL listeners above (no exceptions)
```

### Composer.tsx (input — active when thread is open)
```
Emits:
  - OUTBOUND_SEND     → on send button click
  - TYPING_START      → on input change (throttled, 1 per 2s)
  - TYPING_STOP       → on send, on input clear, on 3s idle
```

---

## Dead Code — Remove

| Event | Why |
|---|---|
| `contact-list:update` / `CONTACT_LIST_UPDATE` | Legacy full-list refresh, replaced by `conversation:updated` delta. Remove from `socket-events.ts`, `app.event-handler.ts`, and any frontend listener. |

---

## Rules — Production Non-Negotiables

1. **Every join has a leave.** If `CONTACT_JOIN` fires on mount, `CONTACT_LEAVE` fires on
   unmount. Every `socket.on()` has a `socket.off()` in the cleanup. No exceptions.

2. **Room-scoped where possible, global only when needed.** Thread events (MESSAGE_NEW,
   OUTBOUND_SENT, TYPING_UPDATE, etc.) go to `contact:${contactId}` room. Sidebar events
   (CONVERSATION_UPDATED, NOTIFICATION_NEW_MESSAGE, PRESENCE) go global. Never send a
   thread-level event globally — it leaks data when assignment ships in V2.

3. **Sender deduplication.** When Agent A sends and gets back MESSAGE_NEW from the room,
   they already have the optimistic bubble. Match by messageId, skip the duplicate. Never
   show the same message twice.

4. **Debounce sidebar re-sorts.** 200ms debounce on CONVERSATION_UPDATED. Patch data
   immediately, re-sort visually once after the burst.

5. **Auto-clear typing.** Frontend clears typing indicators after 3s of no update. Never
   trust the client to send TYPING_STOP reliably (tab close, crash, network drop).

6. **Watermark only moves forward.** Mark-as-read never rewinds lastReadAt to an older
   timestamp. Prevents races where a slow tab resets a read state.

7. **Reconnect = resync.** On reconnect: refetch sidebar list via HTTP, refetch open
   thread gap, re-join rooms. Assume all events during disconnect were lost.

8. **No business logic in the gateway.** The gateway routes events and manages rooms.
   All business logic (create message, update status, permission checks) lives in
   services. The gateway is a thin transport layer.

9. **Server-side validation on every client event.** OUTBOUND_SEND validates permission
   + contact exists + channel active. CONTACT_JOIN validates the user can see this
   contact. Never trust the client payload.

10. **Graceful degradation.** If a socket event fails to emit (Redis down, room empty),
    log it but never crash the request. The HTTP layer is the fallback — a page refresh
    always shows the correct state. Sockets are an optimization, not the source of truth.

---

## Adding a New Event (Checklist for Future Features)

1. Add the constant to `socket-events.ts` with a clear name.
2. Choose scope: room (`contact:${id}`) or global (`server.emit()`).
3. Define the payload type in a shared types file.
4. Add the emit in the appropriate service (via `app.event-handler.ts`).
5. Add the listener in the correct frontend component (see Listener Map).
6. Add cleanup in the component's `useEffect` return.
7. Document in this file: event name, payload, emitter, listener, flow.
8. If room-scoped: verify it doesn't leak to unauthorized sockets.
9. If it changes the sidebar: emit a corresponding CONVERSATION_UPDATED delta.
10. Test: two browser tabs, two different agents, verify both see the event correctly.