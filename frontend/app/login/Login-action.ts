'use server';
import { setAuthToken } from '@/lib/Auth';
import { redirect } from 'next/navigation';

export async function loginAction(formData: FormData) {
  const UserName = formData.get('username');
  const password = formData.get('password');



 
  // 1️⃣ Next.js server → NestJS
  const res = await fetch(
    `${(process.env.NEST_API_URL || '').trim()}/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UserName, password }),
    },
  );

  if (!res.ok) {
    throw new Error('Invalid credentials');
  }

  // 2️⃣ Receive JWT from NestJS
  const data = await res.json();

  console.log("the data has came ", data)
  // 3️⃣ Store JWT in HttpOnly cookie
  await setAuthToken(data.access_token);


  //redirect users 
  redirect('/users');
}
