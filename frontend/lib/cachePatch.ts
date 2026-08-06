// lib/cachePatch.ts

import { QueryClient } from '@tanstack/react-query';
import { Conversation, Message, Channel, ConversationUpdatedPayload, parseSocketConversation , ConversationNewPayload ,conversationFromNewPayload  } from '@/contracts/socketEvents';
import { qk } from './queryKeys';
import { useInboxStore } from '@/stores/inboxStore';

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
// 🟢 LIVE — sidebar bump + unread on CONVERSATION_UPDATED
// Assumes backend now sends `lastMessageChannel` on this payload (the change
// we just agreed on). Do not wire this in until that field is actually there
// — otherwise `payload.lastMessageChannel` is undefined and qk.conversations()
// gets called with an invalid key.
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
    lastMessageAt: payload.lastActivityAt,
  };

  queryClient.setQueryData<Conversation[]>(key, [
    updated,
    ...oldList.filter((c) => c.contactId !== payload.contactId),
  ]);

  const { activeContactId, incrementUnread } = useInboxStore.getState();
  const isViewing = activeContactId === payload.contactId && document.visibilityState === 'visible';

  if (!isViewing && payload.unreadDelta > 0) {
    incrementUnread(payload.contactId, payload.unreadDelta);
  }
}


// ============================================================================
// CONVERSATION_NEW (brand-new contact card inserted into sidebar)
// ============================================================================

export function insertNewConversation(
  queryClient: QueryClient,
  payload: ConversationNewPayload
): void {
  const key = qk.conversations(payload.channel || 'WHATSAPP');
  const oldList = queryClient.getQueryData<Conversation[]>(key);
  if (!oldList) return; // this channel's sidebar was never fetched this session

  if (oldList.some((c) => c.contactId === payload.contactId)) return; // already present, don't duplicate

  const newRow = conversationFromNewPayload(payload);
  queryClient.setQueryData<Conversation[]>(key, [newRow, ...oldList]);

  const { activeContactId, incrementUnread } = useInboxStore.getState();
  const isViewing = activeContactId === payload.contactId && document.visibilityState === 'visible';

  if (!isViewing) {
    incrementUnread(payload.contactId, 1);
  }
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
  // Watch out: sort pages[0] by seq (or createdAt, since seq isn't sent yet)
  // after insert — socket delivery order isn't guaranteed.
  throw new Error('not implemented');
}