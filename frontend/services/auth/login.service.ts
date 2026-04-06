'use server';

import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';
import { setAuthToken, clearAuthToken, getAuthToken } from '@/lib/Auth';
import { redirect } from 'next/navigation';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type PermissionRule = {
    action: string;
    subject: string;
    conditions?: Record<string, unknown> | null;
};

type CurrentUserResponse = {
    id: string;
    userName: string;
    email: string | null;
    displayName: string | null;
    role: string;
    permissions?: PermissionRule[];
};

/** What getCurrentUser() returns */
export type UserSession = {
    id: string;
    userName: string;
    email: string | null;
    displayName: string | null;
    role: string;
    permissions: PermissionRule[];
};

export type LoginResult = {
    success: true;
} | {
    success: false;
    error: string;
};

// ═══════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════

export async function login(formData: FormData): Promise<LoginResult> {
    const userName = (formData.get('username') as string)?.trim();
    const password = formData.get('password') as string;

    // Client-side validation
    if (!userName || !password) {
        return { success: false, error: 'Username and password are required' };
    }

    try {
        const API_URL = (process.env.NEST_API_URL || '').trim();

        const res = await fetch(`${API_URL}${API.AUTH.LOGIN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userName, password }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const data = body?.data || body;
            return {
                success: false,
                error: data?.error?.message || data?.message || 'Invalid credentials',
            };
        }

        const responseBody = await res.json();
        const data = responseBody?.data || responseBody;

        // Store JWT in HttpOnly cookie (persistent, 30 days)
        console.log("return of login ", responseBody)
        await setAuthToken(data.access_token);
    } catch {
        return { success: false, error: 'Unable to reach server. Please try again.' };
    }

    // Redirect happens outside try-catch (Next.js throws NEXT_REDIRECT)
    redirect('/dashboard');
}

// ═══════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════

export async function logout() {
    await clearAuthToken();
    redirect('/login');
}

// ═══════════════════════════════════════════════════════════════════
// GET CURRENT USER + PERMISSIONS
// ═══════════════════════════════════════════════════════════════════

export async function getCurrentUser(): Promise<UserSession | null> {
    try {
        const token = await getAuthToken();
        if (!token) return null;

        const data = await apiClient<CurrentUserResponse>(API.AUTH.ME);

        return {
            id: data.id,
            userName: data.userName,
            email: data.email,
            displayName: data.displayName,
            role: data.role,
            permissions: data.permissions || [],
        };
    } catch {
        return null;
    }
}
