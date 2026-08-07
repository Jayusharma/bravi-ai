// lib/socketListeners.ts

import { QueryClient } from '@tanstack/react-query';
import { getSocket } from './socket';
import { SOCKET_EVENTS } from './socket-events';
import { ConversationUpdatedPayloadSchema , ConversationNewPayloadSchema, ReadUpdatedEventSchema, UnreadSummarySchema } from '@/contracts/socketEvents';
import { applyConversationUpdate , insertNewConversation, applyReadUpdate } from './cachePatch';
import { qk } from './queryKeys';

let attached = false;

export async function ensureListeners(queryClient: QueryClient): Promise<void> {
  if (attached) return;
  attached = true;

  const sock = await getSocket();

  sock.on(SOCKET_EVENTS.CONVERSATION_UPDATED, (raw: unknown) => {
    const parsed = ConversationUpdatedPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[Socket] Invalid CONVERSATION_UPDATED, dropped:', parsed.error);
      return;
    }
    applyConversationUpdate(queryClient, parsed.data);
  });

   sock.on(SOCKET_EVENTS.CONVERSATION_NEW, (raw: unknown) => {
    const parsed = ConversationNewPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[Socket] Invalid CONVERSATION_NEW, dropped:', parsed.error);
      return;
    }
    insertNewConversation(queryClient, parsed.data);
  });

  sock.on(SOCKET_EVENTS.READ_UPDATED, (raw: unknown) => {
    const parsed = ReadUpdatedEventSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[Socket] Invalid READ_UPDATED, dropped:', parsed.error);
      return;
    }
    applyReadUpdate(queryClient, parsed.data);
  });

  sock.on(SOCKET_EVENTS.UNREAD_SUMMARY, (raw: unknown) => {
    const parsed = UnreadSummarySchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[Socket] Invalid UNREAD_SUMMARY, dropped:', parsed.error);
      return;
    }
    // Server sends the full authoritative summary — write straight into the cache,
    // no invalidate-and-refetch needed.
    queryClient.setQueryData(qk.unreadSummary(), parsed.data);
  });
}

export function resetListenersGuard(): void {
  attached = false;
}