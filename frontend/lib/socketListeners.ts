// lib/socketListeners.ts

import { QueryClient } from '@tanstack/react-query';
import { getSocket } from './socket';
import { SOCKET_EVENTS } from './socket-events';
import { ConversationUpdatedPayloadSchema , ConversationNewPayloadSchema } from '@/contracts/socketEvents';
import { applyConversationUpdate , insertNewConversation } from './cachePatch';

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
}

export function resetListenersGuard(): void {
  attached = false;
}