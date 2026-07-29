'use client';

/**
 * SocketContext: owns the single WebSocket connection for the entire dashboard session.
 * Connects on dashboard mount → disconnects on logout/leave.
 * Exposes connectionStatus, lastEventAt (for gap recovery), unread counters, and toasts.
 */

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

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface SocketContextValue {
  socket: Socket | null;
  connectionStatus: ConnectionStatus;
  lastEventAt: Date | null;
  unreadContacts: Record<string, number>;
  totalUnread: number;
  clearUnread: (contactId: string) => void;
  setActiveContactId: (id: string | null) => void;
  setConversations: (convs: ConversationPreview[]) => void;
  chatUnreadByConversation: Record<string, number>;
  chatUnread: number;
  clearConversationUnread: (conversationId: string) => void;
  setActiveChatConversation: (conversationId: string | null) => void;
  conversationsVersion: number;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [unreadContacts, setUnreadContacts] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [chatUnreadByConversation, setChatUnreadByConversation] = useState<Record<string, number>>({});
  const [conversationsVersion, setConversationsVersion] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const activeContactIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationPreview[]>([]);
  const activeChatConversationRef = useRef<string | null>(null);
  const hasConnectedOnce = useRef(false);

  const router = useRouter();

  const clearUnread = useCallback((contactId: string) => {
    setUnreadContacts(prev => {
      if (!prev[contactId]) return prev;
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
  }, []);

  const setActiveContactId = useCallback((id: string | null) => {
    activeContactIdRef.current = id;
    if (id) clearUnread(id);
  }, [clearUnread]);

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

  const setActiveChatConversation = useCallback((conversationId: string | null) => {
    activeChatConversationRef.current = conversationId;
    if (conversationId) clearConversationUnread(conversationId);
  }, [clearConversationUnread]);

  // Seed initial internal chat unread counters
  useEffect(() => {
    listConversations()
      .then((convs) => {
        const map: Record<string, number> = {};
        for (const c of convs) if (c.unreadCount > 0) map[c.id] = c.unreadCount;
        setChatUnreadByConversation(map);
      })
      .catch(() => {});
  }, []);

  // Single socket lifecycle for the dashboard
  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const sock = await getSocket();
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
          // ✅ Bumps lastEventAt on connect & reconnect for Offline Gap Recovery
          setLastEventAt(new Date());
        });

        sock.on('disconnect', () => {
          if (mounted) setConnectionStatus('disconnected');
        });

        sock.on('connect_error', () => {
          if (mounted) setConnectionStatus('disconnected');
        });

        // Global incoming message event
        sock.on(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, (data: {
          contactId: string;
          enquiryId: string;
          messagePreview: string;
          messageId: string;
        }) => {
          if (!mounted) return;
          setLastEventAt(new Date());

          if (data.contactId === activeContactIdRef.current) return;

          setUnreadContacts(prev => ({
            ...prev,
            [data.contactId]: (prev[data.contactId] || 0) + 1,
          }));

          const contactName =
            conversationsRef.current.find(c => c.contactId === data.contactId)?.contactName
            ?? 'New Message';

          setToasts(prev => [
            ...prev.slice(-4),
            {
              id: data.messageId || `toast-${Date.now()}`,
              contactName,
              message: data.messagePreview || 'New message',
              contactId: data.contactId,
              timestamp: new Date(),
            },
          ]);
        });

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
          setConversationsVersion(v => v + 1);
        });

        sock.on(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, () => {
          if (!mounted) return;
          setConversationsVersion(v => v + 1);
        });

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
      disconnectSocket();
    };
  }, []);

  const totalUnread = Object.values(unreadContacts).reduce((sum, n) => sum + n, 0);
  const chatUnread = Object.values(chatUnreadByConversation).reduce((sum, n) => sum + n, 0);

  const handleToastClick = useCallback((contactId: string) => {
    router.push(`/messaging?contact=${contactId}`);
  }, [router]);

  const handleDismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

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
          Reconnecting to live server…
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

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be called inside SocketProvider');
  return ctx;
}
