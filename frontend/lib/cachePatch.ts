import { QueryClient } from '@tanstack/react-query';
import { Message, Conversation } from '@/contracts/socketEvents';
import { qk } from './queryKeys';

/**
 * ============================================================================
 * STEP 6: CONVERSATION SIDEBAR CACHE PATCH HELPERS (Layer 4)
 * Spec Ref: Section 12.2 (Bump-to-top)
 * Contains ONLY the sidebar conversation card update & re-ordering helper.
 * ============================================================================
 */

export interface InfiniteMessagesData {
  pages: Message[][];
  pageParams: (string | null | undefined)[];
}

/**
 * Bumps or inserts a conversation card in the sidebar conversations list query cache.
 * When a new message arrives, moves the conversation card to position 0 (top of list).
 */
export function bumpConversation(
  queryClient: QueryClient,
  msg: Message
): void {
  const channels = ['ALL', 'WHATSAPP', 'EMAIL'] as const;

  channels.forEach((ch) => {
    const key = qk.conversations(ch);
    const oldList = queryClient.getQueryData<Conversation[]>(key);
    if (!oldList) return;

    const idx = oldList.findIndex((c) => c.contactId === msg.contactId);

    // If brand-new contact identity not in cache, invalidate list to force fresh fetch
    if (idx === -1) {
      queryClient.invalidateQueries({ queryKey: key });
      return;
    }

    const nextList = [...oldList];
    const target = nextList[idx];

    const updatedRow: Conversation = {
      ...target,
      lastMessagePreview: msg.body || (msg.channelMeta?.subject as string) || 'Attachment',
      lastMessageAt: msg.createdAt,
      lastMessageChannel: msg.channel,
    };

    // Move updated conversation card to TOP of list (Bump-to-top)
    nextList.splice(idx, 1);
    nextList.unshift(updatedRow);

    queryClient.setQueryData<Conversation[]>(key, nextList);
  });
}

/**
 * Upserts a live socket message directly into the contact's infinite query message thread cache.
 */
export function upsertMessage(
  queryClient: QueryClient,
  contactId: string,
  incoming: Message
): void {
  const key = qk.messages(contactId);

  queryClient.setQueryData<InfiniteMessagesData>(key, (old) => {
    if (!old || !old.pages || old.pages.length === 0) return old;

    const pages = [...old.pages];
    const head = [...pages[0]];

    // 1. Optimistic reconciliation (replace temp clientMessageId if exists)
    if (incoming.clientMessageId) {
      const matchIdx = head.findIndex((m) => m.clientMessageId === incoming.clientMessageId);
      if (matchIdx !== -1) {
        head[matchIdx] = incoming;
        pages[0] = head;
        return { ...old, pages };
      }
    }

    // 2. Dedupe by server id (reconnect replay guard)
    if (head.some((m) => m.id === incoming.id)) {
      return old;
    }

    // 3. Append to head page
    head.unshift(incoming);
    pages[0] = head;
    return { ...old, pages };
  });
}
