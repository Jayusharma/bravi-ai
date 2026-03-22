'use client';

import { useAuthStore } from '@/stores/auth-store';

export function WelcomeMessage() {
    const user = useAuthStore((s) => s.user);

    return (
        <p className="page-description">
            Welcome back, {user?.displayName || user?.userName || 'there'}
        </p>
    );
}
