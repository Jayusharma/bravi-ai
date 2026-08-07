import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import * as Sentry from '@sentry/nextjs';
import './globals.css';
import '../styles/dashboard-shell.css';
import '../styles/permission-matrix.css';
import '../styles/toast.css';
import { ThemeProvider, ThemeScript } from '@/components/common';
import { ToastProvider } from '@/components/ui/Toast';
import { ReactQueryProvider } from '@/components/common/Providers';

// UI chrome (Sans) vs. raw data — phone/email/IDs/timestamps (Mono) — see globals.css
const plexSans = IBM_Plex_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-plex-sans',
    display: 'swap',
});
const plexMono = IBM_Plex_Mono({
    subsets: ['latin'],
    weight: ['400', '500'],
    variable: '--font-plex-mono',
    display: 'swap',
});

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
            <body className={`antialiased ${plexSans.variable} ${plexMono.variable}`}>
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
