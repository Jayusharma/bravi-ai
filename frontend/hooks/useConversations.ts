import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Conversation, Message, Channel, parseSocketConversation, parseSocketMessage } from '@/contracts/socketEvents';
import { qk } from '@/lib/queryKeys';
import { InfiniteMessagesData } from '@/lib/cachePatch';
import { getConversations, getConversationThread } from '@/services/messaging/chat.service';

/**
 * ============================================================================
 * STEP 7: CONVERSATION & MESSAGE HOOKS
 * Spec Ref: Section 12.1, Section 6, & Section 16 Step 7
 * Custom hooks wrapping TanStack Query for conversations list, row-level isolation,
 * and infinite message history pagination.
 * ============================================================================
 */

/**
 * Fetches and subscribes to the unified or channel-filtered conversations sidebar list.
 */
export function useConversations(channel?: Channel | 'ALL') {
  return useQuery<Conversation[]>({
    queryKey: qk.conversations(channel),
    queryFn: async () => {
      const activeChannelParam = channel && channel !== 'ALL' ? channel : undefined;
      console.log(`📥 [TanStack Query L4] Executing queryFn for key:`, qk.conversations(channel));
      
      const res = await getConversations({ channel: activeChannelParam });
      const rawList = res.data || [];
      console.log(`📦 [NestJS Backend API] Received ${rawList.length} raw conversation records:`, rawList);

      // Validate each record with Zod & normalize
      const conversations: Conversation[] = rawList.map(parseSocketConversation);
      console.log(`🛡️ [Zod Validator] Parsed & normalized ${conversations.length} conversation cards:`, conversations);

      return conversations;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Row-level isolation selector hook. Returns ONLY the single conversation row for contactId.
 * Structural sharing ensures that untouched rows maintain reference equality and DO NOT re-render.
 */
export function useConversationRow(contactId: string, channel?: Channel | 'ALL') {
  return useQuery<Conversation[], Error, Conversation | undefined>({
    queryKey: qk.conversations(channel),
    queryFn: async () => {
      const activeChannelParam = channel && channel !== 'ALL' ? channel : undefined;
      const res = await getConversations({ channel: activeChannelParam });
      const rawList = res.data || [];
      return rawList.map(parseSocketConversation);
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
      if (!contactId) return [];
      const threadData = await getConversationThread(contactId);
      console.log("came inside the use message ")
      // Backend returns enquiries newest-first, each enquiry's own messages ascending —
      // flatMap alone concatenates those per-enquiry blocks, not a global chronological
      // stream. seq is authoritative and unique per contact now, so a single global sort
      // fixes it regardless of how many enquiries the thread spans.
      const rawMessages = threadData?.enquiries?.flatMap((e) => e.messages) || [];
      console.log("rawMessages", threadData)
      const final = (rawMessages.map(parseSocketMessage).filter(Boolean) as Message[])
        .sort((a, b) => a.seq - b.seq);
      console.log("final data is ", final )
      return final

    },
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) return null;
      const oldestMessage = lastPage[lastPage.length - 1];
      return oldestMessage ? oldestMessage.id : null;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
