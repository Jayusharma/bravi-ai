import { QueryClient } from '@tanstack/react-query';
import { getSocket } from './socket';
import { SOCKET_EVENTS } from './socket-events';
import { parseSocketMessage } from '@/contracts/socketEvents';
import { upsertMessage, bumpConversation } from './cachePatch';
import { useInboxStore } from '@/stores/inboxStore';

/**
 * ============================================================================
 * STEP 9: GLOBAL SOCKET LISTENERS (Layer 2)
 * Spec Ref: Section 2 (L2), Section 3.2, & Section 9
 * Non-React listener module that routes socket events to L3 store and L4 cache.
 * 
 * HARD INVARIANTS:
 * - Never imports React or any component.
 * - Idempotent `ensureListeners` prevents duplicate listener bindings.
 * - Validates all incoming payloads with Zod before writing to cache/store.
 * ============================================================================
 */

let attached = false;

/**
 * Attaches global socket event listeners once per application lifecycle.
 * Idempotent guard ensures multiple calls cause zero duplicate bindings.
 */
export async function ensureListeners(queryClient: QueryClient): Promise<void> {
  if (attached) return;
  attached = true;

  const sock = await getSocket();
  console.log('⚡ [SocketListeners] Attaching global WebSocket event handlers');

  // ── 1. NEW INBOUND / OUTBOUND MESSAGE ──
  const handleNewMessage = (raw: unknown) => {
    console.log('⚡ [Socket Event] Received message payload:', raw);
    const msg = parseSocketMessage(raw);

    // 1. Update TanStack Query message thread cache
    upsertMessage(queryClient, msg.contactId, msg);

    // 2. Bump sidebar conversation card to top
    bumpConversation(queryClient, msg);

    // 3. Update Zustand unread badge if not actively viewing contact
    const activeContactId = useInboxStore.getState().activeContactId;
    const isViewing = activeContactId === msg.contactId && document.visibilityState === 'visible';

    if (!isViewing && msg.direction === 'INBOUND') {
      useInboxStore.getState().incrementUnread(msg.contactId);
    }
  };

  sock.on(SOCKET_EVENTS.MESSAGE_NEW, handleNewMessage);
  sock.on('chat:new-message', handleNewMessage);
  sock.on(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, handleNewMessage);

  // ── 2. SIDEBAR CONVERSATION UPDATED ──
  sock.on(SOCKET_EVENTS.CONVERSATION_UPDATED, (raw: unknown) => {
    console.log('⚡ [Socket Event] Conversation updated:', raw);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  });

  sock.on(SOCKET_EVENTS.CONVERSATION_NEW, (raw: unknown) => {
    console.log('⚡ [Socket Event] New conversation created:', raw);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  });
}

/**
 * Resets attached state guard. Called on logout.
 */
export function resetListenersGuard(): void {
  attached = false;
}
