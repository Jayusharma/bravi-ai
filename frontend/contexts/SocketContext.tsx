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

  // Refs avoid stale closures inside socket event callbacks without triggering re-renders
  const socketRef = useRef<Socket | null>(null);
  const activeContactIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationPreview[]>([]);
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
      disconnectSocket(); // called only here — no other component should ever call this
    };
  }, []); // socket lifecycle runs once per dashboard mount

  const totalUnread = Object.values(unreadContacts).reduce((sum, n) => sum + n, 0);

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
