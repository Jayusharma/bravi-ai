import type { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import './globals.css';
import '../styles/dashboard-shell.css';
import '../styles/permission-matrix.css';
import '../styles/toast.css';
import { ThemeProvider, ThemeScript } from '@/components/common';
import { ToastProvider } from '@/components/ui/Toast';
import { ReactQueryProvider } from '@/components/common/Providers';

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
                <ReactQueryProvider>
                    <ThemeProvider>
                        <ToastProvider>
                            <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh the page.</p>}>
                                {children}
                            </Sentry.ErrorBoundary>
                        </ToastProvider>
                    </ThemeProvider>
                </ReactQueryProvider>
            </body>
        </html>
    );
}
