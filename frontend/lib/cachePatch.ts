// lib/cachePatch.ts

import { QueryClient } from '@tanstack/react-query';
import { Conversation, Message, Channel, ConversationUpdatedPayload, parseSocketConversation , ConversationNewPayload ,conversationFromNewPayload, ReadUpdatedEvent } from '@/contracts/socketEvents';
import { qk } from './queryKeys';

export interface InfiniteMessagesData {
  pages: Message[][];
  pageParams: (string | null | undefined)[];
}

/**
 * ============================================================================
 * CACHE PATCH HELPERS — ordered by build sequence, same convention as the
 * schema file. 🟢 = live and wired. 🔵 = stub, not called by anything yet.
 * ============================================================================
 */


// ============================================================================
// 🟢 LIVE — sidebar bump on CONVERSATION_UPDATED
// Patches the cached row with the contact's latest message + seq state. No
// separate unread bookkeeping here — the badge is derived at render time from
// lastMessageSeq - lastReadSeq on the row this function just patched.
// ============================================================================

export function applyConversationUpdate(
  queryClient: QueryClient,
  payload: ConversationUpdatedPayload
): void {
  const key = qk.conversations(payload.lastMessageChannel);
  const oldList = queryClient.getQueryData<Conversation[]>(key);
  if (!oldList) return; // this channel's sidebar was never fetched this session — nothing to patch

  const idx = oldList.findIndex((c) => c.contactId === payload.contactId);
  if (idx === -1) return; // contact not in this cached list

  const updated: Conversation = {
    ...oldList[idx],
    lastMessagePreview: payload.lastMessagePreview,
    lastMessageAt: payload.lastMessageAt,
    lastMessageSeq: payload.lastMessageSeq,
    lastReadSeq: payload.lastReadSeq,
  };

  queryClient.setQueryData<Conversation[]>(key, [
    updated,
    ...oldList.filter((c) => c.contactId !== payload.contactId),
  ]);
}


// ============================================================================
// CONVERSATION_NEW — new contact conversation, OR an existing contact's new
// enquiry (backend fires this event on every enquiry.created, not just for
// contacts we've never seen — see the trigger-bug note in the verification
// report). Patch-or-insert: if the row already exists, patch it exactly like
// applyConversationUpdate does instead of silently dropping the update; only
// insert a new row when the contact genuinely isn't in the cache yet. This
// makes the function correct regardless of which case the event means —
// it no longer needs to know.
// ============================================================================

export function insertNewConversation(
  queryClient: QueryClient,
  payload: ConversationNewPayload
): void {
  const key = qk.conversations(payload.channel || 'WHATSAPP');
  const oldList = queryClient.getQueryData<Conversation[]>(key);
  if (!oldList) return; // this channel's sidebar was never fetched this session

  const idx = oldList.findIndex((c) => c.contactId === payload.contactId);

  if (idx !== -1) {
    // Existing contact, new enquiry — patch the row and bump it to the top,
    // same fields applyConversationUpdate patches.
    const updated: Conversation = {
      ...oldList[idx],
      lastMessagePreview: payload.lastMessagePreview,
      lastMessageAt: payload.lastMessageAt,
      lastMessageSeq: payload.lastMessageSeq,
      lastReadSeq: payload.lastReadSeq,
    };
    queryClient.setQueryData<Conversation[]>(key, [
      updated,
      ...oldList.filter((c) => c.contactId !== payload.contactId),
    ]);
    return;
  }

  const newRow = conversationFromNewPayload(payload);
  queryClient.setQueryData<Conversation[]>(key, [newRow, ...oldList]);
}


// ============================================================================
// 🟢 LIVE — read:updated syncs lastReadSeq across every open tab of this user.
// Patches every cached conversations list variant (unified + per-channel keys
// can all hold the same contact's row simultaneously) — no reorder, a read
// doesn't change recency. The unread badge on the row recomputes itself at
// render time from the patched lastReadSeq.
// ============================================================================

export function applyReadUpdate(
  queryClient: QueryClient,
  payload: ReadUpdatedEvent
): void {
  queryClient.setQueriesData<Conversation[]>(
    { predicate: (query) => query.queryKey[0] === 'conversations' },
    (oldList) => {
      if (!oldList) return oldList;
      const idx = oldList.findIndex((c) => c.contactId === payload.contactId);
      if (idx === -1) return oldList;
      const next = [...oldList];
      next[idx] = { ...next[idx], lastReadSeq: payload.lastReadSeq };
      return next;
    },
  );
}


// ============================================================================
// 🔵 STUB — MESSAGE_NEW → upsert into an open thread's message cache
// Needs useContactRoom actually mounted in ChatView first — this function is
// meaningless to build against until room-join exists, since MESSAGE_NEW
// won't reach the client at all otherwise.
// ============================================================================

export function upsertMessage(
  queryClient: QueryClient,
  contactId: string,
  incoming: Message
): void {
  // TODO:
  // 1. read the InfiniteMessagesData at qk.messages(contactId)
  // 2. if no cache entry, return old (thread never opened, nothing to patch)
  // 3. if incoming.clientMessageId matches an existing message in pages[0],
  //    replace it (this is our own optimistic message being confirmed)
  // 4. else if incoming.id already exists in pages[0], return old (dedup —
  //    reconnect replay or duplicate delivery)
  // 5. else unshift into pages[0]
  // Watch out: sort pages[0] by seq after insert — socket delivery order isn't guaranteed.
  throw new Error('not implemented');
}