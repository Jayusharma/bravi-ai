# Inbox Realtime — Build Checklist

Ordered by dependency. Each phase is verifiable before the next starts.
**Rule: no phase begins until the previous one passes its checkpoint.**

---

## ✅ ALREADY DONE — do not rebuild

- Socket singleton: single-flight connection, refcounted rooms, HMR guard, reconnect status on `sock.io`
- `useContactRoom` / `useChatRoom` hooks, wired in `WhatsAppChatView`
- `activeContactId` set on sidebar click, cleared on inbox page unmount
- `CONVERSATION_UPDATED` → `applyConversationUpdate` → sidebar bump-to-top (tested, zero network calls)
- `CONVERSATION_NEW` → `insertNewConversation` → new row inserted (tested)
- Zod contracts for both above, `safeParse` drop-and-log
- `useConversations` / `useConversationRow` with `select` row isolation
- `useMessages` infinite query, cursor pagination
- `ensureListeners` idempotent attach, called once from inbox layout

---

## PHASE A — `seq` foundation (BACKEND ONLY)

Everything downstream is a guess without this. Nothing else starts until it's done.

### A1. Monotonic `seq` per contact on every message
- New column on `ConversationMessage`: `seq Int`
- Scoped **per contact**, not global, not per enquiry — a contact's thread is the unit the UI renders
- Gap-free and strictly increasing. Assign inside the same transaction that writes the message, or you get duplicate/skipped values under concurrent inbound
- Backfill existing rows: order by `createdAt` per contact, number them 1..n
- Unique index on `(contactId, seq)` — makes a gap or duplicate a hard failure instead of silent corruption

**Why per-contact and not global:** the client caches and reconciles per contact. A global counter means every client's "am I up to date" check is comparing against a number that moves for reasons unrelated to them.

### A2. `lastMessageSeq` + `lastReadSeq` on conversation rows
- Both are **absolute values, never deltas**
- Must appear identically in:
  - `GET /conversations` REST response
  - `CONVERSATION_UPDATED` socket payload
  - `CONVERSATION_NEW` socket payload
- **Delete `unreadDelta` from all payloads.** Deltas are the bug — two devices applying deltas independently diverge and never re-converge.

### A3. `seq` on `MESSAGE_NEW` payload
- Inside the `message` object, alongside `id` and `createdAt`

**CHECKPOINT A:** log a real `CONVERSATION_UPDATED` and a real `MESSAGE_NEW`. Confirm `seq`, `lastMessageSeq`, `lastReadSeq` are present and are numbers. No `unreadDelta` anywhere.

---

## PHASE B — server-owned read state

Fixes the multi-device divergence. This is the phase that removes a whole bug class rather than patching one.

### B1. Backend: `read:mark` handler
- Client emits `{ contactId }` (no seq — server knows what the latest is; a client-supplied seq is a client-supplied lie waiting to happen)
- Server sets `lastReadSeq = lastMessageSeq` for that contact
- Team watermark: one value per contact, not per user. Anyone reads it → read for everyone. Matches the existing model.

### B2. Backend: `read:updated` broadcast
```ts
this.gateway.server.to(ROOMS.user(userId)).emit('read:updated', { contactId, lastReadSeq });
```
- Goes to **every socket of that user** — the pattern already proven by `CHAT_NOTIFICATION`
- If the watermark is team-wide, broadcast to every online team member's user room, not just the actor

### B3. Frontend: delete client-side unread entirely
- Remove from Zustand: `unreadByContact`, `incrementUnread`, `clearUnread`, `seedUnreadCounts`
- Remove from `applyConversationUpdate`: the whole trailing block — `isViewing`, `visibilityState`, the increment call
- The client no longer computes unread. It subtracts two numbers it was given.

### B4. Frontend: badge derived from the cached row
```tsx
const unread = row.lastMessageSeq - row.lastReadSeq;
```
Reads from the same TanStack row the sidebar already renders. No new state anywhere.

### B5. Frontend: `read:updated` → patch `lastReadSeq` on the row
New patch function, same shape as `applyConversationUpdate`. Badge recomputes automatically because it's subscribed to that row.

### B6. Frontend: emit `read:mark` when
- A contact is opened
- A `MESSAGE_NEW` arrives **while** that contact is open and `document.visibilityState === 'visible'`
- The tab regains visibility while a contact is open

The acting device gets its badge cleared through `read:updated` like every other device — no local shortcut. If it feels slow, that's a server latency problem to measure, not a reason to reintroduce local state.

**CHECKPOINT B:** two browsers, same account. Open Sarah in A, Jack in B. Message Sarah. Both show badge 1 briefly, then **both clear** once A marks read. Close A entirely, message Sarah again — B's badge increments and stays.

---

## PHASE C — message cache correctness

### C1. `upsertMessage` — real implementation
- Dedupe by server `id`
- Sort by `seq` descending after insert (not `createdAt` — `seq` is authoritative now)
- `if (!old) return old` — thread never opened, nothing to patch
- Insert into `pages[0]` (newest page)
- **No `clientMessageId` branch yet** — that arrives in Phase D with optimistic send. Dead code until then.

### C2. Register `MESSAGE_NEW` in the listener
Convert `parseSocketMessage` to strict `safeParse` + drop, matching the other two handlers. The current permissive fallback silently produces wrong objects instead of failing loudly.

### C3. Exact staleness check on contact open
```ts
const cachedMaxSeq = cached?.pages[0]?.[0]?.seq ?? 0;
if (row.lastMessageSeq > cachedMaxSeq) invalidateQueries(qk.messages(contactId));
```
Replaces the `unread > 0` heuristic. Correct in the cases the heuristic silently failed — multi-device reads, messages already live-patched, messages sent from another tab.

### C4. Gap detection while a thread is open
If an incoming `seq` is more than 1 above the current max, messages were missed mid-session (dropped frame, brief network stall). Invalidate rather than inserting a message with a hole behind it.

**CHECKPOINT C:** open Jack, message him — bubble appends, zero network calls. Switch to Sarah while messages arrive for her, switch back — exactly one fetch, complete thread, no duplicates, correct order.

---

## PHASE D — outbound / sending

### D1. Backend: unique index `(channelConnectionId, clientMessageId)`
**Do this before any retry UI exists.** Without it, a retry after a slow-but-successful first attempt sends the customer the same message twice. Send handler treats a duplicate as "already sent, return the existing row."

### D2. Backend: collapse 4 status events into 1
`OUTBOUND_SENT`, `OUTBOUND_FAILED`, `OUTBOUND_RETRY_QUEUED`, `OUTBOUND_DELIVERY_UPDATED` → one `message:status`:
```ts
{ messageId, contactId, clientMessageId, status, seq }
```
Four listeners, four schemas, four patch call sites become one of each — on both sides.

### D3. Frontend: optimistic send
- Generate `clientMessageId` (uuid)
- Write optimistic message into cache: `id: temp-<cid>`, `status: SENDING`, `seq: Infinity` (pins to bottom through any sort, naturally replaced on confirmation)
- Zustand `outbox[cid] = { status, attempts, payload, firstAttemptAt }`
- Clear the composer draft
- Emit

### D4. Frontend: `clientMessageId` reconciliation in `upsertMessage`
Server echo carries the same `clientMessageId` → **replace** the optimistic entry, never append. Skip this and the sender sees their own message twice.

### D5. Frontend: `message:status` → patch that one message's status
Delivery ticks. Do **not** route through any batcher — status ticks are what make sending feel responsive.

### D6. Frontend: 30s timeout sweeper
Runs every 10s. Anything `SENDING` older than 30s → `FAILED`. Without this, a socket that dies mid-send leaves a message on "sending" forever and the agent believes it delivered.

### D7. Frontend: retry UI
Red bubble + retry button. Retry reuses the **identical** `clientMessageId`. Safe only because of D1.

### D8. Backend: outbound must reach all devices and all agents
The sending device gets its confirmation via `message:status`. Every other device/agent gets the full message via `MESSAGE_NEW` to the contact room, plus `CONVERSATION_UPDATED` globally for their sidebar. Verify the sender's own other tabs receive it too — easy to accidentally exclude the origin socket.

**CHECKPOINT D:** send from A → appears instantly, confirms, appears exactly once. B (same account, same contact open) sees it too. Kill the network mid-send → FAILED within 30s → retry → **customer receives exactly one message.**

---

## PHASE E — resilience

### E1. Backend: `sync:since` handler
Client sends `{ cursors: { contactId: lastSeq } }` for cached contacts only. Server replays per contact in `seq` order, capped (~200/room). Over the cap → `{ contactId, tooLarge: true }`.

### E2. Frontend: wire `handleSocketReconnect`
Already written, currently unreachable. Load-bearing order: **rejoin rooms first, then emit `sync:since`.** Reversed, the server replays into rooms you haven't joined and the events vanish.

### E3. Frontend: `tooLarge` → invalidate that thread instead of replaying

### E4. Frontend: always invalidate `qk.conversations()` on reconnect
Sidebar is one small list. One request to make it authoritatively correct is worth it.

### E5. Frontend: connection banner
`connected` / `reconnecting` / `offline`, driven by `reconnect_attempt`. An inbox that silently lies about being live is worse than one that admits it dropped.

**CHECKPOINT E:** kill the socket 60s with messages arriving across two contacts. Reconnect. All messages present, correct order, no duplicates, badges correct.

---

## PHASE F — the enquiry creation race (BACKEND)

Two messages arriving before the first one's enquiry is created → duplicate enquiries or a dropped message.

### F1. Serialize inbound processing per contact
BullMQ group/concurrency key on `contactId`. Message 2 doesn't start "resolve or create enquiry" until message 1 has committed. Different contacts still run in parallel.

### F2. DB constraint backstop
One open enquiry per contact at a time. The queue solves the common case; the constraint is what makes it actually safe rather than usually safe.

**CHECKPOINT F:** send 3 messages in under a second from a brand-new number. One enquiry, three messages, none dropped.

---

## DEFERRED — build only when it hurts

| Item | Trigger to build it |
|---|---|
| 50ms event batcher | Reconnect replay visibly stutters |
| Virtualization | A real thread crosses ~100 messages |
| Typing indicators / presence | Someone actually asks for it |
| Draft persistence per contact | Agents complain about losing half-typed replies |
| Channel adapter registry | Starting the Email implementation |
| Attachment upload in optimistic send | Attachments ship |

---

## EDGE CASE REGISTER

| # | Case | Handled by |
|---|---|---|
| 1 | Message for never-opened thread | `upsertMessage` early return; badge still correct via global event |
| 2 | Own message echoed back | `clientMessageId` replace (D4) |
| 3 | Reconnect replays an applied message | Dedupe by server `id` (C1) |
| 4 | Out-of-order delivery | `seq` sort on insert (C1) |
| 5 | Send succeeds, confirmation never arrives | 30s sweeper (D6) |
| 6 | Retry after slow-but-successful send | Unique index (D1) |
| 7 | **Two devices, one reads, other shows badge** | Server-owned read state (Phase B) |
| 8 | Contact switched mid-send | Optimistic write targets `qk.messages(contactId)` explicitly |
| 9 | Brand-new contact messages in | `CONVERSATION_NEW` → insert |
| 10 | Reconnect gap over cap | `tooLarge` → invalidate (E3) |
| 11 | Background contact's cache goes stale | Exact seq comparison on open (C3) |
| 12 | Malformed payload | `safeParse` drop-and-log everywhere (C2) |
| 13 | Tab backgrounded while contact "open" | `visibilityState` gates `read:mark`, not the badge |
| 14 | Message burst | Correct already; batcher only if it visibly stutters |
| 15 | 3 messages before enquiry exists | Queue serialization (F1) |
| 16 | Mid-session gap (seq jump) | Gap detection → invalidate (C4) |
| 17 | Another agent replies to the same contact | `MESSAGE_NEW` to contact room + global sidebar event |
| 18 | Same contact on WhatsApp and Email | One contact, one thread, per-message channel badge — do not silo |

---

## ORDER, SHORT VERSION

**A → B → C → D → E → F.**

A unlocks everything. B kills the divergence bug class. C makes the thread correct. D makes sending real. E survives network reality. F fixes a backend race that predates all of this.

Do not start D before B is checkpointed — optimistic send on top of client-computed unread means debugging two divergence problems at once.