'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { Avatar } from './ui/Avatar';
import { ThemeToggle } from './ThemeToggle';
import { LogoutButton } from './LogoutButton';
import { NAV_ITEMS, getNavBySection, type NavItem } from '@/lib/navigation';
import { useAuthStore } from '@/stores/auth-store';

interface SidebarClientProps {
    children: ReactNode;
}

/**
 * Client-side sidebar — handles active route, mobile menu, theme toggle.
 * Reads user and permissions directly from Zustand (populated by AuthHydrator).
 * Filters nav items client-side using can().
 */
export function SidebarClient({ children }: SidebarClientProps) {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);
    const { can, user, isLoaded } = useAuthStore();

    // Filter nav items based on Zustand permissions
    const visibleNavItems = isLoaded
        ? NAV_ITEMS.filter((item) => can(item.permission.action, item.permission.subject))
        : [];

    const platformItems = getNavBySection(visibleNavItems, 'platform');
    const settingsItems = getNavBySection(visibleNavItems, 'settings');

    const renderNavLink = (item: NavItem, onClick?: () => void) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
            <Link
                key={item.href}
                href={item.href}
                onClick={onClick}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }`}
            >
                {item.icon}
                {item.label}
            </Link>
        );
    };

    const renderNavSection = (title: string, items: NavItem[], onClick?: () => void) => {
        if (items.length === 0) return null;
        return (
            <div>
                <p className="px-3 text-[11px] font-medium text-sidebar-foreground/50 uppercase tracking-wider mb-2">
                    {title}
                </p>
                <div className="space-y-0.5">
                    {items.map((item) => renderNavLink(item, onClick))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex min-h-screen">
            {/* ══════════════ DESKTOP SIDEBAR ══════════════ */}
            <aside className="hidden md:flex md:flex-col w-[260px] shrink-0 bg-sidebar-background text-sidebar-foreground border-r border-sidebar-border">
                {/* Brand */}
                <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                        E
                    </div>
                    <span className="text-sm font-semibold">Enquiry Hub</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
                    {renderNavSection('Platform', platformItems)}
                    {renderNavSection('Settings', settingsItems)}
                </nav>

                {/* Bottom */}
                <div className="mt-auto border-t border-sidebar-border">
                    <div className="px-3 py-2">
                        <LogoutButton />
                    </div>
                    {user && (
                        <div className="border-t border-sidebar-border p-3">
                            <div className="flex items-center gap-3 px-2 py-1.5 rounded-md">
                                <Avatar fallback={user.displayName || user.userName} size="sm" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{user.displayName || user.userName}</p>
                                    <p className="text-xs text-sidebar-foreground/50 truncate">{user.email || user.role}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </aside>

            {/* ══════════════ MAIN CONTENT ══════════════ */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top Header */}
                <header className="sticky top-0 z-40 h-14 flex items-center gap-4 border-b bg-background/95 backdrop-blur-sm px-4 md:px-6">
                    {/* Mobile hamburger */}
                    <button
                        className="md:hidden inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:bg-accent transition-colors"
                        onClick={() => setMobileOpen(true)}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" />
                        </svg>
                    </button>
                    <div className="flex-1" />
                    <ThemeToggle />
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto p-4 md:p-6">
                    <div className="mx-auto max-w-[1400px]">{children}</div>
                </main>
            </div>

            {/* ══════════════ MOBILE OVERLAY ══════════════ */}
            {mobileOpen && (
                <>
                    <div
                        className="fixed inset-0 z-50 bg-black/50 md:hidden animate-fade-in"
                        onClick={() => setMobileOpen(false)}
                    />
                    <aside className="fixed inset-y-0 left-0 z-50 w-[280px] bg-sidebar-background text-sidebar-foreground border-r border-sidebar-border flex flex-col md:hidden animate-slide-in-right">
                        <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
                            <div className="flex items-center gap-2.5">
                                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                                    E
                                </div>
                                <span className="text-sm font-semibold">Enquiry Hub</span>
                            </div>
                            <button
                                onClick={() => setMobileOpen(false)}
                                className="rounded-md h-8 w-8 inline-flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>

                        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
                            {renderNavSection('Platform', platformItems, () => setMobileOpen(false))}
                            {renderNavSection('Settings', settingsItems, () => setMobileOpen(false))}
                        </nav>

                        {user && (
                            <div className="border-t border-sidebar-border p-3">
                                <div className="flex items-center gap-3 px-2 py-1.5">
                                    <Avatar fallback={user.displayName || user.userName} size="sm" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{user.displayName || user.userName}</p>
                                        <p className="text-xs text-sidebar-foreground/50 truncate">{user.email || user.role}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </aside>
                </>
            )}
        </div>
    );
}
