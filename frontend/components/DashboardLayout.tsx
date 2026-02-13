import Link from 'next/link';
import { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

const NAV_ITEMS = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/enquiry', label: 'Enquiries', icon: '📋' },
    { href: '/users', label: 'Users', icon: '👥' },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen flex bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r bg-card hidden md:flex md:flex-col">
                <div className="p-6 border-b">
                    <h1 className="text-xl font-bold tracking-tight">
                        📩 Enquiry Hub
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1">Management System v1</p>
                </div>
                <nav className="flex-1 space-y-1 p-3">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                            <span>{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                </nav>
                <div className="p-3 border-t">
                    <LogoutButton />
                </div>
            </aside>

            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b p-4 flex items-center justify-between">
                <h1 className="text-lg font-bold">📩 Enquiry Hub</h1>
                <div className="flex gap-2">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-accent transition-colors"
                        >
                            {item.icon}
                        </Link>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-8 md:p-8 pt-20 md:pt-8">
                {children}
            </main>
        </div>
    );
}
