'use client';

import { useAuthStore } from '@/stores/auth-store';
import { ReactNode } from 'react';

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  PermissionGate — Wraps anything that needs a permission check   ║
 * ║                                                                   ║
 * ║  Two uses:                                                        ║
 * ║  1. Wrap a BUTTON or small UI:                                    ║
 * ║     <PermissionGate action="create" subject="enquiry">            ║
 * ║       <button>Create Enquiry</button>                             ║
 * ║     </PermissionGate>                                             ║
 * ║                                                                   ║
 * ║  2. Wrap an ENTIRE PAGE:                                          ║
 * ║     <PermissionGate action="read" subject="user" fullPage>        ║
 * ║       <UsersTable ... />                                          ║
 * ║     </PermissionGate>                                             ║
 * ║                                                                   ║
 * ║  Without fullPage: renders nothing if denied (for buttons)        ║
 * ║  With fullPage: renders "Access Denied" message (for pages)       ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

interface PermissionGateProps { 
    action: string;
    subject: string;
    children: ReactNode;
    /** If true, shows "Access Denied" instead of hiding. Use for page-level blocks. */
    fullPage?: boolean;
    /** Optional custom fallback when denied */
    fallback?: ReactNode;
}

export function PermissionGate({
    action,
    subject,
    children,
    fullPage = false,
    fallback,
}: PermissionGateProps) {
    const { can, isLoaded } = useAuthStore();

    // Not loaded yet — show nothing (prevents flash)
    if (!isLoaded) {
        return fullPage ? <PageSkeleton /> : null;
    }

    // Permission granted
    if (can(action, subject)) {
        return <>{children}</>;
    }

    // Permission denied — custom fallback
    if (fallback) {
        return <>{fallback}</>;
    }

    // Permission denied — full page shows "Access Denied"
    if (fullPage) {
        return <AccessDenied />;
    }

    // Permission denied — button/component just hides
    return null;
}

// ── Loading skeleton for page-level gates ──
function PageSkeleton() {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="flex items-center gap-3 text-muted-foreground">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                <span className="text-sm">Loading...</span>
            </div>
        </div>
    );
}

// ── Access Denied for page-level gates ──
function AccessDenied() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive mb-4">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m4.93 4.93 14.14 14.14" />
                </svg>
            </div>
            <h2 className="text-lg font-semibold mb-1">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
                You don&apos;t have permission to access this section.
                Contact your administrator if you believe this is an error.
            </p>
        </div>
    );
}
