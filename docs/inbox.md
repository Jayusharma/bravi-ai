# EnquiryHub — Inbox Realtime Architecture Spec (v2)

**Scope:** frontend state, cache, realtime, and multi-channel architecture for the unified inbox.
**Ships with:** WhatsApp + Email. **Designed for:** Instagram, LinkedIn, SMS added later without touching core.
**Replaces:** `SocketContext` and its nine-field value object.

---

## 0. The governing principle

> **Shared core, channel adapters at the edges. Separate pages, one cache.**

Roughly 80% of an inbox is channel-independent: socket transport, cache patching, dedup, ordering, optimistic send, outbox retry, gap recovery, unread watermark, virtualization, scroll anchoring. That 80% is also where every subtle production bug lives — ordering bugs, dedup misses, duplicate sends.

The remaining 20% is genuinely channel-specific and genuinely easy: composer constraints, bubble rendering, status ladder, identity display.

Duplicating the architecture per channel means duplicating the hard 80% to avoid sharing the easy 20% — and guarantees drift, because a seq-ordering fix applied in two files out of three is discovered by a client, not by you.

**Therefore:** one core, one cache, one set of patch helpers. Channel differences live behind a `ChannelAdapter` interface in `channels/`. Adding Instagram = one adapter file + one registry line + one route file. Nothing in core is touched.

---

## 1. Decisions locked

| # | Decision | Locked as | Why |
|---|---|---|---|
| D1 | Channel in query keys? | **Never.** Channel is a `select`/UI filter | Baking it in is the one irreversible mistake. Channel pages are filtered views of one cache — switching WhatsApp→Email fires zero requests, and a contact who WhatsApps then emails doesn't fragment into two identities. |
| D2 | Flat vs infinite query for messages | **`useInfiniteQuery`, newest-first pages** | Real threads exceed one screen immediately. Retrofitting after patch logic is written means rewriting every patch. |
| D3 | Unread per-user vs team watermark | **Team watermark** (matches backend) | Anyone reads it = read for all. Frontend mirrors server `lastReadAt`, never computes authoritative unread. |
| D4 | Separate channel pages? | **Yes for routes, no for data** | Agents work one channel at a time; the UIs genuinely differ. But siloed *data* kills the Contact/ContactChannel moat — channel-hop, cross-channel attribution, hot-lead scoring all need one identity with an interleaved timeline. |
| D5 | Channel-specific code location | **Only `channels/` and `app/inbox/`** | This is the enforceable test that the architecture held. If a third channel requires edits outside those two directories, the abstraction leaked. |

---

## 2. Layer map

Five layers. Each has one job. No layer reaches past its neighbour.

```
┌──────────────────────────────────────────────────────────────┐
│ L1  lib/socket.ts            module singleton, no state      │
│     creates/holds the connection. zero React.                 │
├──────────────────────────────────────────────────────────────┤
│ L2  lib/socketListeners.ts   all socket.on(...) handlers     │
│     validates (Zod) → batches → routes → writes to L3/L4      │
│     never imports React. never renders.                       │
├──────────────────────────────────────────────────────────────┤
│ L3  stores/inboxStore.ts     browser-only truth (Zustand)     │
│     activeContactId, connection, unread, outbox, typing,      │
│     drafts, seq cursors. wiped on refresh, nothing to refetch │
├──────────────────────────────────────────────────────────────┤
│ L4  TanStack Query cache     server truth, cached             │
│     conversations, messages, contact. written by fetches AND  │
│     by L2 socket patches.                                     │
├──────────────────────────────────────────────────────────────┤
│ L5  channels/*               the ONLY channel-aware code      │
│     adapters: composer rules, bubble render, status ladder,   │
│     identity label, validation. core never branches on channel│
└──────────────────────────────────────────────────────────────┘
```

**The L3/L4 invariant:** if losing it on refresh is fine because the database re-supplies it → L4. If it only exists in this tab and there is nothing to refetch → L3. If it never changes → not state at all (L1).

**The L5 invariant:** grep the codebase for `=== 'WHATSAPP'` or `switch (channel)`. Every hit outside `channels/` is a bug.

---

## 3. Data contracts

### 3.1 Unified socket payload — non-negotiable

The backend emits **one event shape** for every channel. Channel is a field, never a different event name. If WhatsApp and Email emit different shapes today, normalize at the gateway before this frontend is built — otherwise L2 becomes a branch forest and D5 is dead on arrival.

```ts
// contracts/socketEvents.ts
import { z } from 'zod';

export const ChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);
// Adding Instagram: this enum + one adapter file. Nothing else in contracts changes.

export const MessageSchema = z.object({
  id: z.string(),                          // server row id
  seq: z.number(),                         // monotonic per contact — ordering + gap recovery
  clientMessageId: z.string().nullable(),  // outbound only; idempotency key
  contactId: z.string(),
  enquiryId: z.string(),
  channel: ChannelSchema,
  channelConnectionId: z.string(),         // WHICH of our numbers/inboxes — drives reply routing
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  body: z.string(),
  status: z.enum(['SENDING','SENT','DELIVERED','READ','FAILED','BOUNCED']),
  attachments: z.array(AttachmentSchema),
  createdAt: z.string(),
  authorId: z.string().nullable(),
  channelMeta: z.record(z.unknown()).nullable(),  // ← channel-specific payload, opaque to core
});
```

**`channelMeta` is the extension point.** Email puts `{ subject, cc, bcc, inReplyTo, quotedHtml }` there. WhatsApp puts `{ templateName, replyToMessageId }`. Instagram will put `{ storyId, storyMediaUrl }`. **Core never reads this field** — only the channel adapter does, and only the adapter knows its shape. Adding a channel adds no columns to the core contract.

```ts
export const ConversationSchema = z.object({
  contactId: z.string(),
  contactName: z.string(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  lastMessageChannel: ChannelSchema,
  lastReadAt: z.string().nullable(),
  unreadCount: z.number(),                  // server-computed, authoritative on fetch
  channels: z.array(ChannelSchema),         // which channels this contact has used
  assignedToId: z.string().nullable(),
  channelState: z.record(z.unknown()).nullable(),  // ← per-channel send-window state
});
```

**`channelState`** holds `{ WHATSAPP: { windowExpiresAt } }`, later `{ INSTAGRAM: { windowExpiresAt } }`. The adapter's `canSendFreeform()` reads its own slice. Core sees an opaque object.

### 3.2 Event registry

| Event | Payload | L4 write | L3 write |
|---|---|---|---|
| `message:new` | `Message` | upsert `qk.messages(contactId)` + bump `qk.conversations()` | `incrementUnread` if not actively viewing |
| `message:status` | `{ id, contactId, status, seq }` | patch that message | clear `outbox[cid]` on terminal status |
| `message:failed` | `{ clientMessageId, contactId, reason }` | patch → FAILED | `outbox[cid].status = 'FAILED'` |
| `read:updated` | `{ contactId, lastReadAt }` | patch conversation row | `clearUnread(contactId)` |
| `typing:start` / `typing:stop` | `{ contactId, userId, userName }` | — | `setTyping` (auto-expires 4s) |
| `presence:changed` | `{ userId, online }` | — | `setPresence` |
| `contact:updated` | `Contact` | patch `qk.contact(id)` + `qk.conversations()` | — |
| `channel:state` | `{ contactId, channel, state }` | patch `channelState` on conversation row | — |
| `connect`/`disconnect`/`reconnect` | — | reconnect → gap recovery (§8) | `setConnectionStatus` |

`channel:state` replaces what would otherwise be `whatsapp:window`, `instagram:window`, etc. One event, channel as a field. This is D5 applied to the wire protocol.

**Every handler validates with Zod and drops malformed payloads with a log rather than writing them.** A missed message is recoverable by refetch; a corrupted cache entry silently poisons the UI.

---

## 4. Channel adapter contract

```ts
// channels/types.ts
export interface ChannelAdapter {
  id: Channel;
  label: string;
  icon: ComponentType<{ className?: string }>;
  accentColor: string;

  // ---- send-time constraints ----
  /** Can the agent type freeform right now, or is the send window closed? */
  canSendFreeform(conv: Conversation): { allowed: boolean; reason?: string; expiresAt?: string };
  /** Fields the composer must collect beyond `body` (Email: subject). */
  requiredFields: string[];
  attachmentLimits: { maxBytes: number; maxCount: number; mimeTypes: string[] };
  validate(input: SendMessageInput, conv: Conversation): ValidationResult;
  /** Build the channelMeta blob for an outbound message. */
  buildMeta(input: SendMessageInput, conv: Conversation): Record<string, unknown>;

  // ---- render slots ----
  MessageBody: ComponentType<{ message: Message }>;
  ComposerExtras: ComponentType<{ contactId: string; conv: Conversation }>;
  IdentityLabel: ComponentType<{ contact: Contact }>;
  MessageMeta?: ComponentType<{ message: Message }>;   // reply-ref, story-ref, quoted-thread

  // ---- status semantics ----
  statusLadder: MessageStatus[];
  statusLabel(status: MessageStatus): string;

  // ---- preview ----
  /** Sidebar preview text — Email shows subject, WhatsApp shows body. */
  previewText(msg: Message): string;
}
```

```ts
// channels/registry.ts
import { whatsappAdapter } from './whatsapp';
import { emailAdapter } from './email';

export const channelRegistry = {
  WHATSAPP: whatsappAdapter,
  EMAIL: emailAdapter,
} satisfies Record<Channel, ChannelAdapter>;

export const getAdapter = (c: Channel): ChannelAdapter => channelRegistry[c];
```

Every place core needs channel-specific behaviour, it calls `getAdapter(msg.channel).X`. No switch statements outside `channels/`.

### 4.1 WhatsApp adapter — behaviour summary

- `canSendFreeform`: reads `conv.channelState.WHATSAPP.windowExpiresAt`. Expired or null → `{ allowed: false, reason: 'Session window closed — use an approved template' }`. Composer locks to template picker. Countdown shown under 2h remaining.
- **This is the frontend half of the known production bug** where `WhatsAppWindowService.isWindowOpen()` was defined but never called in the send path. Enforce in **both** layers — UI prevents the mistake, backend guarantees it. Frontend-only enforcement is not enforcement.
- `statusLadder`: `SENDING → SENT → DELIVERED → READ`
- `MessageBody`: plain text + media, reply-to quote block from `channelMeta.replyToMessageId`
- `IdentityLabel`: formatted phone

### 4.2 Email adapter — behaviour summary

- `canSendFreeform`: always `{ allowed: true }` — no window.
- `requiredFields`: `['subject']` on thread start; auto-prefill `Re:` on reply.
- `MessageBody`: **DOMPurify-sanitized HTML, always.** Inbound email is untrusted input from the open internet — this is a live XSS vector, not theoretical. Never `dangerouslySetInnerHTML` on raw provider content.
- Quoted-reply collapsing: detect the quote block, collapse behind "show trimmed content." Without this, every message renders the entire thread history inside itself.
- `statusLadder`: `SENDING → SENT → DELIVERED → BOUNCED`. **No READ** — email read receipts are unreliable; showing one would be lying to the agent.
- `previewText`: subject line, not body.

---

## 5. Routes — separate pages, one cache

```
/inbox                      unified, all channels
/inbox/whatsapp             same cache, channelFilter='WHATSAPP'
/inbox/email                same cache, channelFilter='EMAIL'
/inbox/c/[contactId]        one contact, ALL channels interleaved
```

All render the same `<InboxShell channelFilter={...} />`. The filter is a `select` over the existing cache entry — **not** a different query key, **not** a different fetch.

Two things fall out for free: switching WhatsApp→Email is instant with zero network calls, and every contact row links through to the unified thread, so an agent working the WhatsApp view all day still sees "this person also emailed you Tuesday." That cross-channel visibility is impossible if the pages own separate caches — it is the Contact/ContactChannel moat, and it is why D4 splits routes but not data.

---

## 6. Query keys

One file. Never inline a key anywhere else — key typos fail **silently**, producing a second empty cache entry rather than an error.

```ts
// lib/queryKeys.ts
export const qk = {
  conversations: () => ['conversations'] as const,
  messages: (contactId: string) => ['messages', contactId] as const,
  contact: (contactId: string) => ['contact', contactId] as const,
  templates: (channel: Channel) => ['templates', channel] as const,
} as const;
```

Note the absence of channel in `messages`. `templates` is channel-keyed because templates genuinely are a per-channel server resource — that's a real fetch boundary, not a UI filter.

---

## 7. Zustand store

```ts
// stores/inboxStore.ts
interface InboxStore {
  activeContactId: string | null;
  channelFilter: Channel | 'ALL';

  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  lastSeqByContact: Record<string, number>;      // gap-recovery cursors

  unreadByContact: Record<string, number>;
  outbox: Record<string, OutboxEntry>;           // keyed by clientMessageId

  typingByContact: Record<string, TypingUser[]>;
  onlineUserIds: string[];

  draftByContact: Record<string, DraftState>;    // survives tab switching
}

interface DraftState {
  body: string;
  channel: Channel;                              // which channel this draft targets
  extras: Record<string, unknown>;               // subject/cc for email, templateId for WA
}

interface OutboxEntry {
  clientMessageId: string;
  contactId: string;
  channel: Channel;
  status: 'SENDING' | 'FAILED';
  attempts: number;
  firstAttemptAt: number;
  payload: SendMessageInput;                     // full payload — retry needs no other source
}
```

**Selector discipline — the rule the whole architecture rests on:**

```ts
// ✅ a primitive
const count = useInboxStore((s) => s.unreadByContact[contactId]);

// ❌ an object — every badge wakes on every message. Context problem, rebuilt.
const counts = useInboxStore((s) => s.unreadByContact);

// ❌ new object literal each call — re-renders on EVERY store change, always
const { a, b } = useInboxStore((s) => ({ a: s.a, b: s.b }));

// ✅ when two fields are genuinely needed together
const { a, b } = useInboxStore(useShallow((s) => ({ a: s.a, b: s.b })));
```

This single mistake silently undoes everything. Add it to the review checklist.

---

## 8. Message cache shape + patch helpers

Cached value for `qk.messages(contactId)` is an infinite-query structure:

```ts
{
  pages: [
    [msg50, msg49, ... msg31],   // page 0 = NEWEST
    [msg30, msg29, ... msg11],   // page 1 = older
  ],
  pageParams: [null, 'cursor-31'],
}
```

**Ordering convention — write it down, don't rediscover it:**
- Page 0 is newest. `fetchNextPage` **appends** older pages to the end.
- Live messages **prepend into `pages[0]`**.
- Render with `flex-direction: column-reverse` — cheaper than reversing arrays, and gives correct scroll anchoring during prepends for free.

All patching lives in **one file** so the ordering and dedup guarantees exist in exactly one place:

```ts
// lib/cachePatch.ts

export function upsertMessage(contactId: string, incoming: Message) {
  queryClient.setQueryData(qk.messages(contactId), (old: InfiniteMessages | undefined) => {
    if (!old) return old;   // never opened — nothing to patch; fetch-on-open will get it

    const pages = [...old.pages];
    const head = [...pages[0]];

    // 1. optimistic reconciliation — our own message, confirmed
    if (incoming.clientMessageId) {
      const i = head.findIndex((m) => m.clientMessageId === incoming.clientMessageId);
      if (i !== -1) { head[i] = incoming; pages[0] = head; return { ...old, pages }; }
    }

    // 2. dedupe by server id — reconnect replay may deliver an already-applied message
    if (head.some((m) => m.id === incoming.id)) return old;

    // 3. genuinely new
    head.unshift(incoming);
    head.sort((a, b) => b.seq - a.seq);
    pages[0] = head;
    return { ...old, pages };
  });
}
```

**Why sort on every insert:** sockets do not guarantee arrival order, especially during reconnect replay. The head page is ~20 items, so the sort is free, and it eliminates an entire bug class permanently.

Also in this file: `upsertMessages` (batch variant), `patchMessageStatus`, `bumpConversation`. **Unit test all four in isolation** — they carry every ordering, dedup, and idempotency guarantee in the system.

---

## 9. Reconnect and gap recovery

Timestamps are the wrong cursor — clock skew between server instances and same-millisecond ties both break ordering. Use the server-issued monotonic `seq` per contact.

**Protocol:**
1. Every applied `message:new` sets `lastSeqByContact[contactId] = payload.seq`.
2. On `reconnect`: `socket.emit('sync:since', { cursors: getState().lastSeqByContact })` — only for contacts actually cached; replaying into a nonexistent cache entry is wasted work.
3. Server replays per room in `seq` order, capped at `MAX_REPLAY` (suggest 200/room).
4. Gap exceeds cap → server returns `{ contactId, tooLarge: true }` → client **invalidates and refetches** that thread instead of replaying. Cheaper and guaranteed correct.
5. Always `invalidateQueries(qk.conversations())` on reconnect regardless. The sidebar is one small list; one request to make it authoritatively correct is worth it.

**Enable Socket.IO Connection State Recovery (v4.6+)** for the sub-second blip. It's in-memory with a short window, so it covers the wifi flicker, not the tunnel. Cursor recovery sits underneath as the real guarantee. Use both — they don't conflict.

**Never drive the UI banner from `socket.connected` alone.** Show `reconnecting` from `reconnect_attempt`, and a distinct `offline` after N failures. An inbox that silently lies about being live is worse than one that admits it dropped — an agent confidently working a stale list is exactly how leads get missed.

---

## 10. Event batching

Ten messages in two seconds must not produce ten cache writes and ten render passes.

```ts
// lib/eventBatcher.ts — buffer 50ms, flush once
const buffer: Message[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function queueMessage(msg: Message) {
  buffer.push(msg);
  if (timer) return;
  timer = setTimeout(() => {
    const batch = buffer.splice(0);
    timer = null;
    const byContact = groupBy(batch, (m) => m.contactId);
    for (const [contactId, msgs] of Object.entries(byContact)) {
      upsertMessages(contactId, msgs);        // one write per contact
    }
    applyUnreadDeltas(byContact);             // ONE Zustand set() for all contacts
  }, 50);
}
```

**50ms is deliberate:** below human perception for chat, wide enough to collapse a realistic burst (customer sending three in a row, or reconnect replay). **Exception:** don't batch `message:status` for the active conversation's own outbound messages — status ticks are what make sending feel responsive, and they're low-volume.

---

## 11. Optimistic send — full lifecycle

```
User hits send
  ├─ adapter.validate(input, conv) → block on failure, show reason
  ├─ generate clientMessageId (uuid)
  ├─ meta = adapter.buildMeta(input, conv)
  ├─ L4: upsertMessage(contactId, { ...optimistic, id: `temp-${cid}`,
  │       status: 'SENDING', seq: Infinity, channelMeta: meta })
  │       └─ seq: Infinity pins it to the bottom through any sort,
  │          and is naturally replaced by the real seq on confirmation
  ├─ L3: outbox[cid] = { status:'SENDING', attempts:1, payload, firstAttemptAt: now }
  ├─ L3: clear draftByContact[contactId]
  └─ socket.emit('message:send', { ...payload, clientMessageId: cid })
        │
        ├─ SUCCESS → server emits message:new with same clientMessageId
        │            upsertMessage matches by cid → REPLACES optimistic entry
        │            L3: delete outbox[cid]
        │
        ├─ REJECT  → server emits message:failed
        │            L4: status = FAILED   L3: outbox[cid].status = 'FAILED'
        │            UI: red bubble + Retry
        │
        └─ SILENCE → 30s sweeper flips it to FAILED
```

**The sweeper is mandatory.** Without it a socket that dies mid-send leaves a message on `SENDING` forever and the agent believes it was delivered.

```ts
setInterval(() => {
  const { outbox } = useInboxStore.getState();
  for (const e of Object.values(outbox)) {
    if (e.status === 'SENDING' && Date.now() - e.firstAttemptAt > 30_000) markFailed(e.clientMessageId);
  }
}, 10_000);
```

**Retry reuses the identical `clientMessageId`** — and that is only safe if the backend enforces it. Requires a unique index on `(channelConnectionId, clientMessageId)`, with the send handler treating a duplicate as "already sent, return existing row." Without that constraint, retrying after a slow-but-successful first attempt sends the customer the same message twice. **Retry idempotency is a backend guarantee, not a frontend hope.**

---

## 12. Sidebar behaviour

### 12.1 Row-level isolation

```ts
export function useConversationRow(contactId: string) {
  return useQuery({
    queryKey: qk.conversations(),
    queryFn: fetchConversations,
    select: (rows) => rows.find((r) => r.contactId === contactId),
  });
}
```

TanStack's structural sharing keeps untouched rows at their original object reference, so `select` returns an identical reference and that row doesn't re-render. **This only holds if the patch rebuilds only the changed row.** A lazy `rows.map(r => ({...r}))` creates new references for everything and silently re-renders all 30 — the exact failure mode this architecture exists to prevent.

### 12.2 Bump-to-top

```ts
export function bumpConversation(msg: Message) {
  queryClient.setQueryData(qk.conversations(), (old: Conversation[] | undefined) => {
    if (!old) return old;
    const idx = old.findIndex((c) => c.contactId === msg.contactId);

    if (idx === -1) {   // brand-new contact — can't fabricate a row
      queryClient.invalidateQueries({ queryKey: qk.conversations() });
      return old;
    }

    const updated = {
      ...old[idx],
      lastMessagePreview: getAdapter(msg.channel).previewText(msg),
      lastMessageAt: msg.createdAt,
      lastMessageChannel: msg.channel,
    };
    return [updated, ...old.filter((c) => c.contactId !== msg.contactId)];
  });
}
```

Note `previewText` comes from the adapter — Email shows the subject, WhatsApp shows the body. Core doesn't know or care which.

### 12.3 Unread ownership

- **On fetch:** server `unreadCount` is authoritative; seed Zustand from it.
- **On socket:** increment locally, no round trip.
- **On open:** clear locally *and* emit `read:mark`. Server broadcasts `read:updated` to all of that user's sockets — **this is what makes multi-tab work for free**, with no BroadcastChannel and no shared worker.
- **Never increment while actively viewing:**

```ts
const isViewing =
  payload.contactId === getState().activeContactId &&
  document.visibilityState === 'visible';
```

The `visibilityState` half matters — an agent with the tab backgrounded is reading nothing, and clearing their badge means they miss the lead.

---

## 13. Thread rendering

- **Virtualize** (`@tanstack/react-virtual`) above ~100 messages. Non-negotiable for long real-estate threads.
- **Scroll anchoring:** auto-scroll to bottom on new message **only** if the user is within ~100px of the bottom. Otherwise show a "New message ↓" pill. Yanking an agent away from history they're reading is the most-hated bug in every chat UI ever shipped.
- **Load older:** IntersectionObserver on a top sentinel → `fetchNextPage`. Never raw scroll events.
- **Bubble rendering:** `const { MessageBody, MessageMeta } = getAdapter(message.channel)`. Core renders the frame (alignment, timestamp, status ticks, channel badge); the adapter renders the contents.
- **Channel badge on every bubble.** In an interleaved timeline this isn't decoration — it's the only way an agent knows which channel a reply goes out on.

---

## 14. Config

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,        // socket is the realtime source; don't race it
      gcTime: 30 * 60_000,          // switching back to a chat stays instant for 30 min
      refetchOnWindowFocus: false,  // see below
      retry: 2,
    },
  },
});
```

**`refetchOnWindowFocus: false` specifically:** the default `true` is right for apps with no realtime channel. With a live socket it is actively harmful — an agent alt-tabbing back mid-send triggers a refetch whose response predates their optimistic message, which then vanishes and flickers back a moment later.

---

## 15. Edge case register

| # | Scenario | Handling |
|---|---|---|
| 1 | Message for never-opened conversation | `upsertMessage` early-returns on `!old`; unread still increments; full fetch on open |
| 2 | Own message echoed back | Matched and replaced by `clientMessageId`, never appended |
| 3 | Reconnect replays an applied message | Deduped by server `id` |
| 4 | Out-of-order socket delivery | Sorted by `seq` on every insert |
| 5 | Send succeeds, confirmation never arrives | 30s sweeper → FAILED → retry same cid → backend index dedupes |
| 6 | Retry after slow-but-successful send | Unique index on `(channelConnectionId, clientMessageId)` returns existing row |
| 7 | Two tabs, one user | Server broadcasts `read:updated` to all sockets; zero client coordination |
| 8 | Contact switched mid-send | Optimistic write targets `qk.messages(contactId)` explicitly, never "current active" |
| 9 | Brand-new contact messages in | `bumpConversation` hits `idx === -1` → invalidate list |
| 10 | Reconnect gap exceeds replay cap | `tooLarge` → invalidate + refetch that thread |
| 11 | WhatsApp window expired | `adapter.canSendFreeform()` locks composer to templates; backend re-validates independently |
| 12 | Malformed socket payload | Zod rejects, logs, drops — cache never corrupted |
| 13 | Agent scrolled up on arrival | No auto-scroll; "New message ↓" pill |
| 14 | Burst of 10 messages in 2s | 50ms batcher → one cache write, one render |
| 15 | Email with hostile HTML | DOMPurify in the Email adapter's `MessageBody`, always |
| 16 | Tab backgrounded, conversation "active" | `visibilityState` check prevents wrongly clearing unread |
| 17 | Socket dies while composing | Draft persisted per contact in Zustand; consider `sessionStorage` for refresh survival |
| 18 | Attachment upload in flight on send | Optimistic message shows local blob URL; swapped on confirmation; failed upload → whole message FAILED |
| 19 | Typing indicator from a user who disconnects | Auto-expire 4s; never rely on a `typing:stop` that may never arrive |
| 20 | Same contact on two channels | One conversation row, one interleaved thread, per-message channel badge |
| 21 | Contact replies on Email to a WhatsApp thread | Same `contactId`, different `channelConnectionId`; thread interleaves; composer defaults to the channel of the **last inbound** message |
| 22 | Agent replies on the wrong channel | Composer channel selector shows only channels in `conv.channels`; outbound routes on `channelConnectionId`, never on "contact default" |
| 23 | Adapter missing for a channel in a payload | `getAdapter` throws loudly in dev, falls back to a plain-text adapter in prod. Never silently drop the message. |

---

## 16. Build order

Each step independently verifiable. Do not proceed until the prior one is confirmed.

1. `contracts/socketEvents.ts` — Zod schemas. **First** — everything downstream consumes these types.
2. `lib/queryKeys.ts` — key registry.
3. `channels/types.ts` — `ChannelAdapter` interface. **Before any component**, so components are written against the contract from the start rather than retrofitted.
4. `lib/socket.ts` — connection singleton. Verify: connects, survives HMR without duplicating listeners.
5. `stores/inboxStore.ts` — full store. Verify: `getState()` mutations work from the browser console.
6. `lib/cachePatch.ts` — `upsertMessage`, `upsertMessages`, `patchMessageStatus`, `bumpConversation`. **Unit test in isolation.**
7. `hooks/useConversations.ts`, `useConversationRow.ts`, `useMessages.ts`.
8. `lib/eventBatcher.ts`.
9. `lib/socketListeners.ts` — all events → batcher → patch helpers.
10. `channels/whatsapp.tsx` + `channels/email.tsx` + `channels/registry.ts`.
11. `components/Sidebar`, `ConversationRow`, `UnreadBadge`. **Verify with React DevTools Profiler: one message for Jack highlights exactly one row.** If more light up, stop and fix the selector before continuing — every later step compounds on this.
12. `components/ChatView` — infinite query, virtualization, scroll anchoring, adapter-driven bubbles.
13. Optimistic send + outbox + sweeper + retry UI + adapter validation.
14. Reconnect + gap recovery + connection banner.
15. Routes: `/inbox`, `/inbox/whatsapp`, `/inbox/email`, `/inbox/c/[contactId]` — all one `<InboxShell>`.

---

## 17. Acceptance tests

Ship nothing until every one passes manually.

**Rendering isolation**
- [ ] Message for Jack while viewing Sarah → **only Jack's row re-renders** (Profiler-verified)
- [ ] Message for Jack while viewing Jack → appears instantly, **no badge**, **no network request**
- [ ] 10 messages in 2s → Profiler shows **one render pass** per affected component

**Cache**
- [ ] Jack → Sarah → Jack within 60s → **zero network requests, zero spinner**
- [ ] `/inbox/whatsapp` → `/inbox/email` → **zero network requests**

**Send**
- [ ] Send → appears instantly → confirmation replaces it → **never appears twice**
- [ ] Kill network mid-send → FAILED within 30s → retry succeeds → **customer receives exactly one message**

**Realtime**
- [ ] Socket down 60s with messages arriving → reconnect → **all present, correct order, no duplicates**
- [ ] Two tabs → read in A → **badge clears in B**
- [ ] Scrolled up on arrival → **no scroll jump**, pill appears

**Channel**
- [ ] WhatsApp window expired → **freeform composer disabled**, templates forced
- [ ] Email with `<script>` in body → **renders inert**
- [ ] Contact with both channels → **one row, one interleaved thread**, correct badges
- [ ] Reply routes out on the correct `channelConnectionId`

**Architecture — the test that proves the abstraction held**
- [ ] `grep -r "'WHATSAPP'" src/ --exclude-dir=channels` returns **zero hits** outside `channels/` and `contracts/`
- [ ] A stub third channel can be added by touching **only** `channels/` + one route file + the `ChannelSchema` enum

---

# BUILD PROMPT — hand this to Claude Code

```
Read INBOX_REALTIME_SPEC_V2.md in full before writing any code.

CONTEXT
EnquiryHub frontend: Next.js 16, TypeScript, Socket.IO client, TanStack Query v5,
Zustand v5. We are replacing an existing SocketContext that holds nine values in one
Provider value object, causing the entire component tree to re-render on every socket
event. Shipping WhatsApp + Email now; Instagram and others later.

TASK
Implement the architecture in the spec, following section 16's build order exactly.
Do not skip ahead or bundle steps.

PROTOCOL — "scaffold with holes"
For each step:
1. Read the relevant spec sections before writing.
2. Generate file structure, types, imports, and function signatures.
3. Leave DECISION LOGIC as clearly marked TODO stubs — specifically:
   - the bodies of every lib/cachePatch.ts function
   - the routing conditions inside lib/socketListeners.ts
   - the optimistic send state machine transitions
   - each adapter's canSendFreeform() and validate()
   I write those myself.
4. Fully implement the mechanical parts: Zod schemas, query key registry, socket
   singleton, store scaffolding, hook wiring, component structure, adapter shells.
5. STOP after each step. Report what you built and what you left stubbed. Wait.

HARD CONSTRAINTS
- No channel-specific logic outside channels/ and app/inbox/. No switch statements on
  channel in core. Core calls getAdapter(channel).X instead.
- Channel is NEVER part of a query key (except qk.templates, which is a real per-channel
  server resource).
- Zustand selectors return primitives or single objects — never a new object literal
  without useShallow. Flag any violation you find in existing code.
- Query keys come only from lib/queryKeys.ts. No inline key arrays anywhere.
- lib/socketListeners.ts must not import React or any component.
- Every socket handler validates with Zod before writing to any store or cache.
- Socket events go through the 50ms batcher, except message:status on the active
  conversation.
- Messages use useInfiniteQuery, newest-first pages. Every patch helper respects that.
- Optimistic messages use seq: Infinity, reconciled by clientMessageId.
- Channel-specific payload data goes in channelMeta / channelState. Never add a
  channel-specific top-level field to the core Message or Conversation contract.

BEFORE YOU START — audit and report only. Do not fix, do not write code.
1. Does the backend emit ONE unified message:new shape for both WhatsApp and Email, or
   two different event names/shapes? Report exactly what it emits today.
2. Does every message carry a monotonic per-contact `seq`? If not, that's a backend
   change and a hard blocker for gap recovery — flag it.
3. Is there a unique index on (channelConnectionId, clientMessageId)? Retry idempotency
   depends on it. Missing = retry can double-send to a real customer.
4. Is WhatsAppWindowService.isWindowOpen() called in the send path yet? It was
   previously defined but never invoked.
5. List every component currently consuming SocketContext — the full migration surface.
6. Does the Conversation payload already carry per-channel window state, and in what
   shape? We need it under channelState.

Report all six answers first. Write no code until I have reviewed them.
```