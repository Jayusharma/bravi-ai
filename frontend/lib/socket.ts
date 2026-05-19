'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let connectionPromise: Promise<Socket> | null = null;

// Registry of rooms joined — re-joined on reconnect
const joinedRooms = new Set<string>();

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/socket');
  if (!res.ok) throw new Error('Failed to get WebSocket token — not authenticated');
  const { token } = await res.json();
  return token;
}

async function createConnection(): Promise<Socket> {
  const token = await fetchToken();

  const sock = io(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001', {
    // Dynamic auth: called on every connection attempt (including reconnects),
    // so the token is always fresh and never stale after expiry.
    auth: async (cb: (data: { token: string }) => void) => {
      try {
        const freshToken = await fetchToken();
        cb({ token: freshToken });
      } catch {
        cb({ token });
      }
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  sock.on('connect', () => {
    console.log('🔌 WebSocket connected:', sock.id);
    // Re-join all rooms after reconnect
    for (const room of joinedRooms) {
      const [ns, id] = room.split(':');
      if (ns === 'enquiry') sock.emit('enquiry:join', { enquiryId: id });
      if (ns === 'contact') sock.emit('chat:join', { contactId: id });
    }
  });

  sock.on('disconnect', (reason) => {
    console.log('🔌 WebSocket disconnected:', reason);
  });

  sock.on('connect_error', (err) => {
    console.error('🔌 WebSocket connection error:', err.message);
  });

  sock.on('auth-error', (data: { message: string }) => {
    console.error('🔒 WebSocket auth error:', data.message);
    sock.disconnect();
    socket = null;
    window.location.href = '/login';
  });

  socket = sock;
  return sock;
}

/**
 * Returns a shared Socket.IO instance.
 * Concurrent calls share one connection attempt (no duplicate sockets).
 * Dynamic auth ensures token is always fresh on reconnect.
 */
export async function getSocket(): Promise<Socket> {
  if (socket?.connected) return socket;
  if (connectionPromise) return connectionPromise;

  connectionPromise = createConnection().finally(() => {
    connectionPromise = null;
  });
  return connectionPromise;
}

/**
 * Join an enquiry room and register it for auto-rejoin on reconnect.
 */
export async function joinEnquiryRoom(enquiryId: string): Promise<void> {
  const sock = await getSocket();
  const key = `enquiry:${enquiryId}`;
  joinedRooms.add(key);
  sock.emit('enquiry:join', { enquiryId });
}

/**
 * Leave an enquiry room and remove it from the reconnect registry.
 */
export async function leaveEnquiryRoom(enquiryId: string): Promise<void> {
  const key = `enquiry:${enquiryId}`;
  joinedRooms.delete(key);
  if (socket?.connected) {
    socket.emit('enquiry:leave', { enquiryId });
  }
}

/**
 * Disconnect and cleanup. Call on logout.
 */
export function disconnectSocket(): void {
  joinedRooms.clear();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
