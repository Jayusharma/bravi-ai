'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore, type User, type PermissionRule } from '@/stores/auth-store';

/**
 * Hydrates the Zustand + CASL auth store with server-fetched user data.
 * 
 * Flow:
 *  Server Component (DashboardLayout) fetches user from /auth/me
 *  → Passes user + permissions as props to this client component
 *  → This component populates Zustand store + builds CASL ability
 *  → Every client component can now call useAuthStore().can('read','enquiry')
 */
export function AuthHydrator({
    user,
    permissions,
}: {
    user: User | null;
    permissions: PermissionRule[];
}) {
    const setSession = useAuthStore((s) => s.setSession);
    const clearSession = useAuthStore((s) => s.clearSession);
    const hydrated = useRef(false);

    useEffect(() => {
        // Only hydrate once per render cycle
        if (hydrated.current) return;
        hydrated.current = true;

        if (user) {
            setSession(user, permissions);
        } else {
            clearSession();
        }
    }, [user, permissions, setSession, clearSession]);

    return null;
}
