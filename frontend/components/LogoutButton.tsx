'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleLogout = async () => {
        setLoading(true);
        try {
            await fetch('/api/logout', { method: 'POST' });
            router.push('/login');
            router.refresh();
        } catch {
            // Even if logout API fails, redirect to login
            router.push('/login');
        }
    };

    return (
        <button
            onClick={handleLogout}
            disabled={loading}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm font-medium rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
            <span>🚪</span>
            {loading ? 'Logging out...' : 'Logout'}
        </button>
    );
}
