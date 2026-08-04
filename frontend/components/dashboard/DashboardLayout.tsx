import { ReactNode } from 'react';
import { getCurrentUser } from '@/services/auth';
import { AuthHydrator } from '@/components/auth';
import { SidebarClient } from '@/components/common';
import { redirect } from 'next/navigation';

// Server component: authenticates the user, then hands off to client-side providers.
// AuthHydrator runs before any client components read from the store.
export async function DashboardLayout({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();
    if (!user) {
        redirect('/auth/login');
    }

    const permissions = user.permissions || [];

    return (
        <>
            {/* Hydrate Zustand auth store */}
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
