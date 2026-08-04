import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Conversation, Message } from '@/contracts/socketEvents';
import { qk } from '@/lib/queryKeys';
import { InfiniteMessagesData } from '@/lib/cachePatch';

/**
 * ============================================================================
 * STEP 7: CONVERSATION & MESSAGE HOOKS
 * Spec Ref: Section 12.1, Section 6, & Section 16 Step 7
 * Custom hooks wrapping TanStack Query for conversations list, row-level isolation,
 * and infinite message history pagination.
 * 
 * HARD INVARIANTS:
 * - useConversationRow MUST use select with structural sharing so untouched rows never re-render.
 * - Messages query uses useInfiniteQuery with newest-first pages.
 * ============================================================================
 */

/**
 * Fetches and subscribes to the unified conversations sidebar list.
 */
export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: qk.conversations(),
    queryFn: async () => {
      // TODO: Call server action to fetch conversation summaries from PostgreSQL DB, seed Zustand unread counts, and return list.
      // Spec ref: Section 12.1 & Section 12.3 (Unread ownership)
      // Watch out: Must seed Zustand unreadByContact on fetch so UI unread badges are authoritatively initialized.
      throw new Error('not implemented');
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Row-level isolation selector hook. Returns ONLY the single conversation row for contactId.
 * Structural sharing ensures that untouched rows maintain reference equality and DO NOT re-render.
 */
export function useConversationRow(contactId: string) {
  return useQuery<Conversation[], Error, Conversation | undefined>({
    queryKey: qk.conversations(),
    queryFn: async () => {
      // TODO: Delegate to main conversations queryFn or queryClient cache.
      // Spec ref: Section 12.1 (Row-level isolation)
      // Watch out: select function must return the exact same object reference if row data hasn't changed.
      throw new Error('not implemented');
    },
    select: (rows) => rows.find((r) => r.contactId === contactId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Infinite query hook for contact message history thread (Newest-first pages).
 */
export function useMessages(contactId: string | null) {
  return useInfiniteQuery<Message[], Error, InfiniteMessagesData, readonly ['messages', string], string | null>({
    queryKey: qk.messages(contactId || ''),
    enabled: !!contactId,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      // TODO: Call server action to fetch paginated messages for contactId from PostgreSQL DB (cursor: pageParam).
      // Spec ref: Section 8 (Message cache shape) & Section 13 (Thread rendering)
      // Watch out: Page 0 is newest. Older pages are appended to the end of pages array.
      throw new Error('not implemented');
    },
    getNextPageParam: (lastPage) => {
      // TODO: Extract nextCursor from last page or return null if no more pages exist.
      // Spec ref: Section 8
      throw new Error('not implemented');
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false, // Prevents window focus refetch from wiping optimistic messages (§14)
  });
}
