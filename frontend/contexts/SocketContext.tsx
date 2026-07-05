'use client';

// SocketContext: owns the single WebSocket connection for the entire dashboard session.
// Connect on dashboard mount → disconnect on logout/leave. All pages share one socket via useSocket().
// Pattern: SocketProvider wraps DashboardLayout → every route inside the dashboard inherits the live socket.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import MessageToast, { type ToastMessage } from '@/components/messaging/MessageToast';
import type { ConversationPreview } from '@/services/messaging/chat.service';
import { listConversations } from '@/services/chat/chat.service';
import { useAuthStore } from '@/stores/auth-store';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface SocketContextValue {
  socket: Socket | null;
  connectionStatus: ConnectionStatus;
  // Bumped on connect + every NOTIFICATION_NEW_MESSAGE — consumers can re-fetch stale data on reconnect
  lastEventAt: Date | null;
  unreadContacts: Record<string, number>;
  totalUnread: number;
  clearUnread: (contactId: string) => void;
  // Called by messaging/page when the agent opens a conversation — suppresses toast + badge for that contact
  setActiveContactId: (id: string | null) => void;
  // Called by ContactList after load — feeds the name-lookup map used in notification toasts
  setConversations: (convs: ConversationPreview[]) => void;
  // ── Internal team chat (Discord-style) ──
  // Per-conversation unread counts — the nav badge shows the sum
  chatUnreadByConversation: Record<string, number>;
  chatUnread: number; // sum of the map — what SidebarClient renders
  clearConversationUnread: (conversationId: string) => void;
  // The channel/DM currently open — its notifications don't bump the badge
  setActiveChatConversation: (conversationId: string | null) => void;
  // Bumped whenever a conversation changes (created/renamed/members/kick) — ChannelSidebar refetches on it
  conversationsVersion: number;
}

const SocketContext = createContext<SocketContextValue | null>(null);

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [unreadContacts, setUnreadContacts] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [chatUnreadByConversation, setChatUnreadByConversation] = useState<Record<string, number>>({});
  const [conversationsVersion, setConversationsVersion] = useState(0);

  // Refs avoid stale closures inside socket event callbacks without triggering re-renders
  const socketRef = useRef<Socket | null>(null);
  const activeContactIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationPreview[]>([]);
  const activeChatConversationRef = useRef<string | null>(null); // channel/DM currently open
  // Only show "Reconnecting" banner after the first successful connect — never on initial page load
  const hasConnectedOnce = useRef(false);

  const router = useRouter();

  const clearUnread = useCallback((contactId: string) => {
    setUnreadContacts(prev => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
  }, []);

  // Stores which contact is currently visible in the chat — skips toast + badge for it
  const setActiveContactId = useCallback((id: string | null) => {
    activeContactIdRef.current = id;
  }, []);

  // Stores conversation list so toasts can resolve contact names without an extra fetch
  const setConversations = useCallback((convs: ConversationPreview[]) => {
    conversationsRef.current = convs;
  }, []);

  const clearConversationUnread = useCallback((conversationId: string) => {
    setChatUnreadByConversation(prev => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  // Opening a channel/DM zeroes its badge and suppresses further bumps while viewing
  const setActiveChatConversation = useCallback((conversationId: string | null) => {
    activeChatConversationRef.current = conversationId;
    if (conversationId) clearConversationUnread(conversationId);
  }, [clearConversationUnread]);

  // Seed the per-conversation unread map from the sidebar feed once on mount
  useEffect(() => {
    listConversations()
      .then((convs) => {
        const map: Record<string, number> = {};
        for (const c of convs) if (c.unreadCount > 0) map[c.id] = c.unreadCount;
        setChatUnreadByConversation(map);
      })
      .catch(() => { /* not authenticated yet — leave empty */ });
  }, []);

  // ── Single socket lifecycle for the entire dashboard session ──
  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const sock = await getSocket(); // reuses existing singleton + JWT auth from lib/socket.ts
        if (!mounted) return;

        socketRef.current = sock;
        setSocket(sock);

        if (sock.connected) {
          hasConnectedOnce.current = true;
          setConnectionStatus('connected');
        }

        sock.on('connect', () => {
          if (!mounted) return;
          hasConnectedOnce.current = true;
          setConnectionStatus('connected');
          setLastEventAt(new Date());
        });

        sock.on('disconnect', () => {
          if (mounted) setConnectionStatus('disconnected');
        });

        sock.on('connect_error', () => {
          if (mounted) setConnectionStatus('disconnected');
        });

        // Global broadcast: server fires this for all connected users whenever an inbound message arrives
        sock.on(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, (data: {
          contactId: string;
          enquiryId: string;
          messagePreview: string;
          messageId: string;
        }) => {
          if (!mounted) return;
          setLastEventAt(new Date());

          // If agent has this contact open they already see the message — no badge or toast needed
          if (data.contactId === activeContactIdRef.current) return;

          setUnreadContacts(prev => ({
            ...prev,
            [data.contactId]: (prev[data.contactId] || 0) + 1,
          }));

          const contactName =
            conversationsRef.current.find(c => c.contactId === data.contactId)?.contactName
            ?? 'New Message';

          setToasts(prev => [
            ...prev.slice(-4), // cap at 5 toasts
            {
              id: data.messageId || `toast-${Date.now()}`,
              contactName,
              message: data.messagePreview || 'New message',
              contactId: data.contactId,
              timestamp: new Date(),
            },
          ]);
        });

        // Keep conversationsRef current for toast name-lookup — patch single cards, never full replace
        sock.on(SOCKET_EVENTS.CONVERSATION_UPDATED, (data: { enquiryId: string; lastActivityAt: string }) => {
          if (!mounted) return;
          conversationsRef.current = conversationsRef.current.map(c =>
            c.enquiryId === data.enquiryId ? { ...c, lastActivityAt: data.lastActivityAt } : c
          );
        });
        sock.on(SOCKET_EVENTS.CONVERSATION_NEW, (data: ConversationPreview) => {
          if (!mounted) return;
          if (!conversationsRef.current.find(c => c.enquiryId === data.enquiryId)) {
            conversationsRef.current = [data, ...conversationsRef.current];
          }
        });

        // Internal team-chat: bump THAT conversation's badge unless it's our own
        // message or we currently have that channel/DM open.
        // (Server only sends this to members — non-members never hear about it.)
        sock.on(SOCKET_EVENTS.CHAT_NOTIFICATION, (data: {
          conversationId: string;
          messageId: string;
          senderId: string;
        }) => {
          if (!mounted) return;
          if (data.conversationId === activeChatConversationRef.current) return;
          if (data.senderId === useAuthStore.getState().user?.id) return;
          setChatUnreadByConversation(prev => ({
            ...prev,
            [data.conversationId]: (prev[data.conversationId] || 0) + 1,
          }));
          // A message in a channel not yet in the sidebar (e.g. fresh DM) → refetch list
          setConversationsVersion(v => v + 1);
        });

        // A conversation changed (created/renamed/archived/members) — sidebar refetches
        sock.on(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, () => {
          if (!mounted) return;
          setConversationsVersion(v => v + 1);
        });

        // We were removed from a channel — drop its badge; the chat page routes away itself
        sock.on(SOCKET_EVENTS.CHAT_MEMBERSHIP_REMOVED, (data: { conversationId: string }) => {
          if (!mounted) return;
          setChatUnreadByConversation(prev => {
            const next = { ...prev };
            delete next[data.conversationId];
            return next;
          });
          setConversationsVersion(v => v + 1);
        });

      } catch {
        if (mounted) setConnectionStatus('disconnected');
      }
    }

    connect();

    return () => {
      mounted = false;
      socketRef.current?.off('connect');
      socketRef.current?.off('disconnect');
      socketRef.current?.off('connect_error');
      socketRef.current?.off(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE);
      socketRef.current?.off(SOCKET_EVENTS.CONVERSATION_UPDATED);
      socketRef.current?.off(SOCKET_EVENTS.CONVERSATION_NEW);
      socketRef.current?.off(SOCKET_EVENTS.CHAT_NOTIFICATION);
      socketRef.current?.off(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED);
      socketRef.current?.off(SOCKET_EVENTS.CHAT_MEMBERSHIP_REMOVED);
      disconnectSocket(); // called only here — no other component should ever call this
    };
  }, []); // socket lifecycle runs once per dashboard mount

  const totalUnread = Object.values(unreadContacts).reduce((sum, n) => sum + n, 0);
  // Nav badge = sum of every channel/DM's unread
  const chatUnread = Object.values(chatUnreadByConversation).reduce((sum, n) => sum + n, 0);

  // Clicking a toast navigates to messaging with the contact pre-selected via URL param
  const handleToastClick = useCallback((contactId: string) => {
    router.push(`/messaging?contact=${contactId}`);
  }, [router]);

  const handleDismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Only show after first successful connect — avoids a "Reconnecting" flash on every page load
  const showReconnectBanner = hasConnectedOnce.current && connectionStatus !== 'connected';

  return (
    <SocketContext.Provider value={{
      socket, connectionStatus, lastEventAt,
      unreadContacts, totalUnread,
      clearUnread, setActiveContactId, setConversations,
      chatUnreadByConversation, chatUnread, clearConversationUnread,
      setActiveChatConversation, conversationsVersion,
    }}>
      {showReconnectBanner && (
        <div className="socket-reconnecting-banner" role="status" aria-live="polite">
          <span className="connection-dot" />
          Reconnecting…
        </div>
      )}
      {children}
      <MessageToast
        toasts={toasts}
        onDismiss={handleDismissToast}
        onClickToast={handleToastClick}
      />
    </SocketContext.Provider>
  );
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

// Use inside any dashboard component to read connection state, unread counts, and socket instance
export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be called inside SocketProvider (wraps DashboardLayout)');
  return ctx;
}
