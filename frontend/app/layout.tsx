import type { Metadata } from 'next';
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
                    <ToastProvider>{children}</ToastProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
