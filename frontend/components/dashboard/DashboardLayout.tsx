import { ReactNode } from 'react';
import { getCurrentUser } from '@/services/auth';
import { AuthHydrator } from '@/components/auth';
import { SidebarClient } from '@/components/common';
import { SocketProvider } from '@/contexts/SocketContext';
import { redirect } from 'next/navigation';

// Server component: authenticates the user, then hands off to client-side providers.
// AuthHydrator runs before SocketProvider so Zustand is hydrated before any child reads from the store.
export async function DashboardLayout({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();
    if (!user) {
        redirect('/auth/login');
    }

    const permissions = user.permissions || [];

    return (
        <>
            {/* Hydrate Zustand auth store — must be outside SocketProvider so SidebarClient can read it */}
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

            {/* SocketProvider owns the single WS connection for the entire dashboard session */}
            <SocketProvider>
                <SidebarClient>
                    {children}
                </SidebarClient>
            </SocketProvider>
        </>
    );
}
