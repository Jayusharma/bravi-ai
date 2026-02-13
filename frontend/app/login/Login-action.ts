'use server';
import { setAuthToken } from '@/lib/Auth';
import { redirect } from 'next/navigation';

const Api_Url = (process.env.NEST_API_URL || '').trim();

export async function loginAction(formData: FormData) {
  const userName = formData.get('username') as string;
  const password = formData.get('password') as string;

  // 1️⃣ Next.js server → NestJS
  const res = await fetch(`${Api_Url}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, password }),
  });

  if (!res.ok) {
    // Try to parse structured error
    try {
      const errorBody = await res.json();
      const data = errorBody?.data || errorBody;
      throw new Error(data?.error?.message || 'Invalid credentials');
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error('Invalid credentials');
    }
  }

  // 2️⃣ Receive response from NestJS
  const responseBody = await res.json();

  // Unwrap the { success, data } envelope
  const data = responseBody?.data || responseBody;
   console.log(data.access_token);
  // 3️⃣ Store JWT in HttpOnly cookie
  await setAuthToken(data.access_token);

  // Redirect to dashboard
  redirect('/dashboard');
}
