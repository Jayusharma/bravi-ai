import type { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import './globals.css';
import '../styles/dashboard-shell.css';
import '../styles/permission-matrix.css';
import '../styles/toast.css';
import { ThemeProvider, ThemeScript } from '@/components/common';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
    title: 'Enquiry Hub - Management System',
    description: 'Enterprise-grade enquiry management with multi-channel ingestion, automation, and team collaboration.',
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <ThemeScript />
            </head>
            <body className="antialiased">
                <ThemeProvider>
                    <ToastProvider>
                        {/* Sentry.ErrorBoundary only catches errors thrown during React
                            render (and in lifecycle/constructor methods below it in the
                            tree) — it does NOT catch errors in event handlers (onClick,
                            onChange, etc.) or async code (fetch, setTimeout, promises).
                            Those still need their own try/catch or .catch(), same as
                            without Sentry. Wraps the whole app for now — Inbox / Context
                            Panel don't exist yet (Block 8, not built), swap this for
                            per-feature boundaries once they do. */}
                        <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh the page.</p>}>
                            {children}
                        </Sentry.ErrorBoundary>
                    </ToastProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
