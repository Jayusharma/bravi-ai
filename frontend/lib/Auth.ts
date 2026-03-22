import { cookies } from 'next/headers';

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME!;

/**
 * Stores JWT in browser cookie (HttpOnly)
 * Runs ONLY on the server
 */
export async function setAuthToken(token: string) {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // true in production (https)
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days — matches backend JWT expiry
  });


}

/**
 * Reads JWT from browser cookie
 * Runs ONLY on the server
 */
export async function getAuthToken() {
  const cookieStore = await cookies();

  return cookieStore.get(COOKIE_NAME)?.value;
}

/**
 * Logout
 */
export async function clearAuthToken() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
