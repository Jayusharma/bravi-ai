import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from './socket-events';
import { useAuthStore } from '@/stores/auth-store';
import { useInboxStore } from '@/stores/inboxStore';

/**
 * ============================================================================
 * STEP 4: SOCKET CONNECTION SINGLETON (Layer 1)
 * Spec Ref: Section 1 (L1), Section 9, & Section 16 Step 4
 * Module singleton holding raw TCP WebSocket connection.
 * 
 * HARD INVARIANTS:
 * - Zero React rendering logic.
 * - Single-flight connection promise deduplication.
 * - Reference-counted room subscriptions (`roomRefs`).
 * - Preserved on globalThis in development to survive Next.js HMR reloads.
 * ============================================================================
 */

// HMR Preservation Guard: Survives Next.js dev mode hot module reloads
const globalForSocket = globalThis as unknown as { __ehSocket?: Socket };

let socket: Socket | null = globalForSocket.__ehSocket ?? null;
let connectionPromise: Promise<Socket> | null = null;

// Registry of active joined rooms with reference counting
const roomRefs = new Map<string, number>();

/**
 * Retains a room reference count. Returns true if this is the first holder.
 */
function retainRoom(key: string): boolean {
  const count = (roomRefs.get(key) ?? 0) + 1;
  roomRefs.set(key, count);
  return count === 1;
}

/**
 * Releases a room reference count. Returns true if this was the last holder.
 */
function releaseRoom(key: string): boolean {
  const count = (roomRefs.get(key) ?? 1) - 1;
  if (count <= 0) {
    roomRefs.delete(key);
    return true;
  }
  roomRefs.set(key, count);
  return false;
}

/**
 * Fetches short-lived WebSocket JWT token from Next.js route handler.
 */
async function fetchToken(): Promise<string> {
  const res = await fetch('/api/socket');
  if (!res.ok) throw new Error('Failed to get WebSocket token — not authenticated');
  const { token } = await res.json();
  return token;
}

/**
 * Handles reconnect gap recovery cursor synchronization.
 * 
 * ⚠️ CRITICAL LOAD-BEARING ORDER:
 * 1. Re-join all active rooms FIRST so the socket is inside the room channels.
 * 2. ONLY THEN emit 'sync:since' with sequence cursors.
 * Reversing this order causes the server to replay events into rooms the socket
 * hasn't joined yet, causing replayed messages to be silently dropped!
 */
export function handleSocketReconnect(sock: Socket): void {
  // TODO: Emits room rejoins FIRST, then emits 'sync:since' with sequence cursors from Zustand store.
  // Spec ref: Section 9 (Protocol steps 1-5) & Section 15 Edge case #10
  // Watch out: Order is load-bearing! Re-join rooms BEFORE emitting sync:since.
  throw new Error('not implemented');
}

/**
 * Handles WebSocket authentication failure cleanly.
 */
export function handleAuthFailure(message: string): void {
  console.error('🔒 WebSocket auth failure:', message);
  disconnectSocket();
  useAuthStore.getState().clearSession();
}

/**
 * Initializes TCP connection with exponential backoff & dynamic auth.
 */
async function createConnection(): Promise<Socket> {
  const sock = io(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001', {
    auth: async (cb: (data: { token: string }) => void) => {
      try {
        const freshToken = await fetchToken();
        cb({ token: freshToken });
      } catch (err) {
        console.error('Failed to fetch WS auth token:', err);
        cb({ token: '' });
      }
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // ── Connection Status Listeners ──
  sock.on('connect', () => {
    console.log('🔌 WebSocket connected:', sock.id);
    useInboxStore.getState().setConnectionStatus('connected');
    
    // Re-join active room references on reconnect
    for (const [room] of roomRefs) {
      const [ns, id] = room.split(':');
      if (ns === 'contact') sock.emit(SOCKET_EVENTS.CONTACT_JOIN, { contactId: id });
      else if (ns === 'chat') sock.emit(SOCKET_EVENTS.CHAT_JOIN, { conversationId: id });
    }
  });

  // Reconnect attempt events live on sock.io (Manager), NOT sock!
  sock.io.on('reconnect_attempt', (attempt) => {
    console.log(`🔌 WebSocket reconnect attempt #${attempt}`);
    useInboxStore.getState().setConnectionStatus(attempt > 5 ? 'offline' : 'reconnecting');
  });

  sock.on('disconnect', (reason) => {
    console.log('🔌 WebSocket disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server forcefully disconnected socket -> try manual reconnect
      sock.connect();
    } else {
      useInboxStore.getState().setConnectionStatus('reconnecting');
    }
  });

  sock.on('connect_error', (err) => {
    console.error('🔌 WebSocket connection error:', err.message);
  });

  sock.on('auth-error', (data: { message: string }) => {
    handleAuthFailure(data.message);
  });

  socket = sock;
  if (process.env.NODE_ENV !== 'production') {
    globalForSocket.__ehSocket = sock;
  }

  return new Promise((resolve, reject) => {
    sock.once('connect', () => resolve(sock));
    sock.once('connect_error', (err) => {
      console.error('🔌 WebSocket initial connection failed:', err.message);
      reject(err);
    });
  });
}

/**
 * Returns shared Socket.IO instance singleton.
 * Concurrent calls share single connection attempt.
 * Gates on socket existence to prevent duplicate io() instances during connecting state.
 */
export async function getSocket(): Promise<Socket> {
  if (socket) return socket;
  if (connectionPromise) return connectionPromise;

  connectionPromise = createConnection().finally(() => {
    connectionPromise = null;
  });
  return connectionPromise;
}

/**
 * Joins contact room & registers key with refcounting for auto-rejoin.
 */
export async function joinContactRoom(contactId: string): Promise<void> {
  const key = `contact:${contactId}`;
  const isFirst = retainRoom(key);
  if (isFirst) {
    const sock = await getSocket();
    sock.emit(SOCKET_EVENTS.CONTACT_JOIN, { contactId });
  }
}

/**
 * Leaves contact room & releases refcount. Emits leave ONLY when last holder unmounts.
 */
export async function leaveContactRoom(contactId: string): Promise<void> {
  const key = `contact:${contactId}`;
  const isLast = releaseRoom(key);
  if (isLast && socket?.connected) {
    socket.emit(SOCKET_EVENTS.CONTACT_LEAVE, { contactId });
  }
}

/**
 * Joins team-chat room & registers key with refcounting.
 */
export async function joinChatRoom(conversationId: string): Promise<void> {
  const key = `chat:${conversationId}`;
  const isFirst = retainRoom(key);
  if (isFirst) {
    const sock = await getSocket();
    sock.emit(SOCKET_EVENTS.CHAT_JOIN, { conversationId });
  }
}

/**
 * Leaves team-chat room & releases refcount. Emits leave ONLY when last holder unmounts.
 */
export async function leaveChatRoom(conversationId: string): Promise<void> {
  const key = `chat:${conversationId}`;
  const isLast = releaseRoom(key);
  if (isLast && socket?.connected) {
    socket.emit(SOCKET_EVENTS.CHAT_LEAVE, { conversationId });
  }
}

/**
 * Disconnects socket and clears room refcounts. Call on logout.
 */
export function disconnectSocket(): void {
  roomRefs.clear();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Dedicated React lifecycle hook that owns room join/leave lifecycle.
 * Prevents drift between React UI state and socket room subscriptions.
 */
export function useContactRoom(contactId: string | null): void {
  useEffect(() => {
    if (!contactId) return;
    joinContactRoom(contactId);
    return () => {
      leaveContactRoom(contactId);
    };
  }, [contactId]);
}

/**
 * Dedicated React lifecycle hook for internal team-chat room join/leave.
 */
export function useChatRoom(conversationId: string | null): void {
  useEffect(() => {
    if (!conversationId) return;
    joinChatRoom(conversationId);
    return () => {
      leaveChatRoom(conversationId);
    };
  }, [conversationId]);
}
