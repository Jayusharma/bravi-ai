// frontend/app/api/auth/ws-token/route.ts

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /api/auth/ws-token
 * 
 * Returns the raw JWT token so the browser can pass it
 * to Socket.IO's auth handshake.
 * 
 * WHY: The JWT is in an HttpOnly cookie → JS can't read it.
 * This endpoint reads it server-side and returns it.
 * 
 * SECURITY: This is safe because:
 * 1. Only same-origin requests can access this (Next.js API route)
 * 2. The token is already in the browser's cookie jar
 * 3. We're not creating a new token, just relaying the existing one
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(
    process.env.AUTH_COOKIE_NAME || 'access_token',
  )?.value;

  if (!token) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 },
    );
  }

  return NextResponse.json({ token });  
}
