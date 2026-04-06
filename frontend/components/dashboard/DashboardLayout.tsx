import { ReactNode } from 'react';
import { getCurrentUser } from '@/services/auth';
import { AuthHydrator } from '@/components/auth';
import { SidebarClient } from '@/components/common';
import { redirect } from 'next/navigation';

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
    if (!user) {
        redirect('/auth/login');
    }

    const permissions = user.permissions || [];

    return (
        <>
            {/* Hydrate Zustand store so client components can use useAuthStore() */}
            <AuthHydrator
                user={{
                    id: user.id,
                    userName: user.userName,
                    email: user.email,
                    displayName: user.displayName,
                    role: user.role,
                }}
                permissions={permissions}
            />

            <SidebarClient>
                {children}
            </SidebarClient>
        </>
    );
}
