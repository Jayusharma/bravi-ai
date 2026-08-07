import { useQuery } from '@tanstack/react-query';
import { getUnreadSummary } from '@/services/messaging/chat.service';
import { qk } from '@/lib/queryKeys';

/**
 * Global per-channel unread-CONTACT-count summary (e.g. { WHATSAPP: 5, EMAIL: 2 }) — powers
 * the nav badges in SidebarClient and InboxSidebar's header total. This is the ONE place
 * this number is computed on the client; both consumers read this hook rather than deriving
 * their own count, so they can never drift apart.
 *
 * Real-time updates arrive via the `unread:summary` socket event (registered in
 * ensureListeners(), app-wide — active before the inbox is ever opened) which writes
 * straight into this query's cache. The fetch here only powers first paint before that
 * event has had a reason to fire; staleTime is a safety net, not a polling mechanism.
 */
export function useUnreadSummary() {
  return useQuery({
    queryKey: qk.unreadSummary(),
    queryFn: getUnreadSummary,
    staleTime: 60_000,
  });
}
