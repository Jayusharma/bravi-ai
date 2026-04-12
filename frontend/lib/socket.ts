// frontend/lib/socket.ts

'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Returns a singleton Socket.IO instance.
 * On first call, fetches the JWT from /api/auth/ws-token
 * and connects with it.
 */
export async function getSocket(): Promise<Socket> {
    if (socket?.connected) return socket;

    // 1. Fetch token from our API route
    const res = await fetch('/api/socket');
    if (!res.ok) {
        throw new Error('Failed to get WebSocket token — not authenticated');
    }
    const { token } = await res.json();

    // 2. Create Socket.IO connection with auth
    socket = io('http://localhost:3001', {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });

    // 3. Handle auth errors
    socket.on('auth-error', (data: { message: string }) => {
        console.error('🔒 WebSocket auth error:', data.message);
        socket?.disconnect();
        socket = null;
        // Optionally redirect to login
        window.location.href = '/login';
    });

    socket.on('connect', () => {
        console.log('🔌 WebSocket connected:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 WebSocket disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
        console.error('🔌 WebSocket connection error:', err.message);
    });

    return socket;
}

/**
 * Disconnect and cleanup.
 * Call on logout.
 */
export function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
