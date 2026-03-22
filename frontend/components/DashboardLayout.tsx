import { ReactNode } from 'react';
import { getCurrentUser } from '@/services/auth/login.service';
import { SidebarClient } from './SidebarClient';
import { AuthHydrator } from './AuthHydrator';

/**
 * Main authenticated layout — server component.
 * 
 * Only TWO jobs:
 *  1. Fetches current user (server-side, via HttpOnly cookie)
 *  2. Hydrates Zustand store via AuthHydrator
 * 
 * All permission checks happen client-side via useAuthStore().can()
 */
export async function DashboardLayout({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();

    const permissions = user?.permissions || [];

    return (
        <>
            {/* Hydrate Zustand store so client components can use useAuthStore() */}
            <AuthHydrator
                user={user ? {
                    id: user.id,
                    userName: user.userName,
                    email: user.email,
                    displayName: user.displayName,
                    role: user.role,
                } : null}
                permissions={permissions}
            />

            <SidebarClient>
                {children}
            </SidebarClient>
        </>
    );
}
