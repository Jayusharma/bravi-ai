'use client';

import { logout } from '@/services/auth/login.service';
import { useAction } from '@/hooks/messaging/use-action';

export function LogoutButton() {
    const { execute, pending } = useAction(logout, {
        refreshOnSuccess: false,
    });

    return (
        <button
            onClick={() => execute()}
            disabled={pending}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-destructive transition-colors disabled:opacity-50"
        >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
            </svg>
            {pending ? 'Logging out...' : 'Logout'}
        </button>
    );
}
