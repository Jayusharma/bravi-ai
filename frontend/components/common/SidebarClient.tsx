 'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogoutButton } from '@/components/auth';
import { Avatar } from '@/components/ui/Avatar';
import { ThemeToggle } from './ThemeToggle';
import { NAV_ITEMS, getNavBySection, type NavItem } from '@/lib/navigation';
import { useAuthStore } from '@/stores/auth-store';

import { useQueryClient } from '@tanstack/react-query';
import { ensureListeners } from '@/lib/socketListeners';

interface SidebarClientProps {
    children: ReactNode;
}

export function SidebarClient({ children }: SidebarClientProps) {
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);
    const { can, user, isLoaded } = useAuthStore();
    
    // ⚡ Boot global Socket.IO listeners once across entire app
    useEffect(() => {
        ensureListeners(queryClient);
    }, [queryClient]);
    // Unread counters — driven by useInboxStore (L3 Zustand)
    const totalUnread = 0;
    const chatUnread = 0;

    // ── Sidebar lock/unlock ──
    const [sidebarLocked, setSidebarLocked] = useState<boolean>(true);
    const [sidebarHovered, setSidebarHovered] = useState(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Sidebar resize ──
    const [sidebarWidth, setSidebarWidth] = useState<number>(292);
    const isSidebarResizing = useRef(false);

    // ── Topbar lock/unlock ──
    const [topbarLocked, setTopbarLocked] = useState<boolean>(true);

    // ── Client-side settings hydration to prevent SSR hydration mismatches ──
    useEffect(() => {
        try {
            const storedSidebarLocked = localStorage.getItem('sidebar-locked');
            if (storedSidebarLocked !== null) {
                setSidebarLocked(storedSidebarLocked === 'true');
            }

            const storedSidebarWidth = localStorage.getItem('sidebar-width');
            if (storedSidebarWidth) {
                setSidebarWidth(Math.max(220, Math.min(420, parseInt(storedSidebarWidth, 10))));
            }

            const storedTopbarLocked = localStorage.getItem('topbar-locked');
            if (storedTopbarLocked !== null) {
                setTopbarLocked(storedTopbarLocked === 'true');
            }
        } catch (err) {
            console.error('Failed to load sidebar/topbar settings from localStorage:', err);
        }
    }, []);

    const toggleTopbarLock = useCallback(() => {
        setTopbarLocked((prev) => {
            const next = !prev;
            localStorage.setItem('topbar-locked', String(next));
            return next;
        });
    }, []);

    const toggleSidebarLock = useCallback(() => {
        setSidebarLocked((prev) => {
            const next = !prev;
            localStorage.setItem('sidebar-locked', String(next));
            if (next) setSidebarHovered(false);
            return next;
        });
    }, []);

    const handleSidebarEnter = useCallback(() => {
        if (sidebarLocked) return;
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setSidebarHovered(true);
    }, [sidebarLocked]);

    const handleSidebarLeave = useCallback(() => {
        if (sidebarLocked) return;
        hoverTimeoutRef.current = setTimeout(() => setSidebarHovered(false), 300);
    }, [sidebarLocked]);

    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        };
    }, []);

    const handleSidebarResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isSidebarResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isSidebarResizing.current) return;
            const newWidth = Math.min(420, Math.max(220, ev.clientX));
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            isSidebarResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setSidebarWidth(w => {
                localStorage.setItem('sidebar-width', String(w));
                return w;
            });
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, []);

    // ── Pins ──
    const [pinned, setPinned] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const storedPins = window.localStorage.getItem('dashboard-pins');
            const parsed: unknown = storedPins ? JSON.parse(storedPins) : [];
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
        } catch {
            return [];
        }
    });
    const [expanded, setExpanded] = useState<string[]>([]);
    const [profileOpen, setProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement | null>(null);

    const visibleNavItems = useMemo(() => {
        if (!isLoaded) return [];
        return NAV_ITEMS.filter((item) => can(item.permission.action, item.permission.subject)).map((item) => ({
            ...item,
            children: item.children?.filter((child) => can(child.permission.action, child.permission.subject)),
        }));
    }, [can, isLoaded]);

    const autoExpanded = useMemo(
        () =>
            visibleNavItems
                .filter((item) => item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + '/')))
                .map((item) => item.href),
        [pathname, visibleNavItems],
    );

    const expandedSet = useMemo(
        () => new Set([...expanded, ...autoExpanded]),
        [autoExpanded, expanded],
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const togglePin = (event: React.MouseEvent, href: string) => {
        event.preventDefault();
        event.stopPropagation();
        setPinned((prev) => {
            const next = prev.includes(href) ? prev.filter((pin) => pin !== href) : [...prev, href];
            localStorage.setItem('dashboard-pins', JSON.stringify(next));
            return next;
        });
    };

    const toggleExpand = (event: React.MouseEvent, href: string) => {
        event.preventDefault();
        event.stopPropagation();
        setExpanded((prev) => prev.includes(href) ? prev.filter((item) => item !== href) : [...prev, href]);
    };

    const moduleItems = getNavBySection(visibleNavItems, 'platform');
    const settingsItems = getNavBySection(visibleNavItems, 'settings');
    const pinnedItems = visibleNavItems.filter((item) => pinned.includes(item.href));

    // ── Render helpers ──
    const renderNavLink = (item: NavItem, isChild = false) => {
        const hasChildren = !!item.children?.length;
        const isExpanded = expandedSet.has(item.href);
        const childActive = item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + '/'));
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/') || !!childActive;
        const isPinned = pinned.includes(item.href);

        return (
            <div key={`${isChild ? 'child' : 'root'}-${item.href}`} className={isChild ? 'sidebar-nav-child' : ''}>
                <div
                    data-active={isActive}
                    onClick={(event) => hasChildren ? toggleExpand(event, item.href) : undefined}
                    className={`sidebar-nav-item group relative flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all ${isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}`}
                >
                    {!hasChildren ? (
                        <Link href={item.href} className="absolute inset-0 z-0" onClick={() => {
                            setMobileOpen(false);
                            if (!sidebarLocked) setSidebarHovered(false);
                        }} />
                    ) : null}

                    <div className="z-10 flex min-w-0 items-center gap-3 pointer-events-none">
                        {item.icon ? (
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors ${isActive ? 'border-border bg-background/70 text-foreground' : 'border-transparent bg-transparent text-muted-foreground group-hover:border-border/50 group-hover:bg-background/55'}`}>
                                {item.icon}
                            </div>
                        ) : null}
                        <span className={`truncate ${isChild ? 'text-[13px]' : 'font-medium'}`}>{item.label}</span>
                    </div>

                    <div className="z-10 flex items-center gap-1">
                        {/* Unread badge — shown for the Inbox nav item when there are unread conversations */}
                        {item.href === '/inbox' && totalUnread > 0 ? (
                            <span className="nav-unread-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
                        ) : null}
                        {/* Unread badge — Team Chat */}
                        {item.href === '/chat' && chatUnread > 0 ? (
                            <span className="nav-unread-badge">{chatUnread > 99 ? '99+' : chatUnread}</span>
                        ) : null}
                        {!isChild ? (
                            <button
                                onClick={(event) => togglePin(event, item.href)}
                                className={`rounded-lg p-1.5 transition-all ${isPinned ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background/80 hover:text-foreground'}`}
                                title={isPinned ? 'Unpin' : 'Pin'}
                            >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m12 17 5 5v-7h4L12 2 3 15h4v7z" />
                                </svg>
                            </button>
                        ) : null}

                        {hasChildren ? (
                            <button
                                onClick={(event) => toggleExpand(event, item.href)}
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                            >
                                <svg className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </button>
                        ) : null}
                    </div>
                </div>

                {hasChildren ? (
                    <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                        <div className="mt-1 ml-8 flex flex-col space-y-1 border-l border-border/60 pl-4">
                            {item.children!.map((child) => renderNavLink(child as NavItem, true))}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    };

    const renderNavSection = (title: string, items: NavItem[]) => {
        if (items.length === 0) return null;
        return (
            <div className="space-y-3">
                <p className="sidebar-section-label px-3 text-[10px] font-semibold uppercase text-muted-foreground/80">
                    {title}
                </p>
                <div className="space-y-1.5">
                    {items.map((item) => renderNavLink(item))}
                </div>
            </div>
        );
    };

    // ── Shared sidebar content (brand header + nav) ──
    const sidebarBrandHeader = (showLock: boolean) => (
        <div className="flex h-20 items-center gap-4 px-6">
            <div className="sidebar-brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-primary-foreground">
                EH
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Company</p>
                <p className="truncate text-lg font-semibold tracking-tight">Enquiry Hub</p>
            </div>
            {showLock ? (
                <button
                    onClick={toggleSidebarLock}
                    className={`sidebar-lock-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all ${sidebarLocked
                        ? 'border-border/80 bg-accent/70 text-foreground'
                        : 'border-border/50 bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        }`}
                    title={sidebarLocked ? 'Unlock sidebar' : 'Lock sidebar'}
                >
                    {sidebarLocked ? (
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    ) : (
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                        </svg>
                    )}
                </button>
            ) : null}
        </div>
    );

    const sidebarNavContent = (
        <nav className="flex-1 overflow-y-auto px-4 pb-6">
            {pinnedItems.length > 0 ? (
                <div className="space-y-3 pb-5">
                    <p className="sidebar-section-label px-3 text-[10px] font-semibold uppercase text-muted-foreground/80">Pinned</p>
                    <div className="space-y-1.5">
                        {pinnedItems.map((item) => renderNavLink(item))}
                    </div>
                    <div className="shell-divider mx-3" />
                </div>
            ) : null}
            <div className="space-y-6">
                {renderNavSection('Modules', moduleItems)}
                {renderNavSection('Administration', settingsItems)}
            </div>
        </nav>
    );

    return (
        <div className="dashboard-shell flex h-screen overflow-hidden text-foreground">

            {/* ═════════ LOCKED SIDEBAR (static, in document flow) ═════════ */}
            {sidebarLocked ? (
                <>
                    <aside
                        className="dashboard-sidebar sidebar-surface hidden shrink-0 md:flex md:flex-col"
                        style={{ width: sidebarWidth }}
                    >
                        {sidebarBrandHeader(true)}
                        {sidebarNavContent}
                    </aside>
                    {/* Sidebar resize handle */}
                    <div
                        className="sidebar-resize-handle"
                        onMouseDown={handleSidebarResize}
                    />
                </>
            ) : (
                <>
                    {/* ═════════ COLLAPSED RAIL (always visible when unlocked) ═════════ */}
                    <div
                        className="sidebar-rail hidden md:flex"
                        onMouseEnter={handleSidebarEnter}
                    />

                    {/* ═════════ HOVER OVERLAY SIDEBAR ═════════ */}
                    <aside
                        className={`dashboard-sidebar sidebar-surface sidebar-overlay hidden md:flex md:flex-col ${sidebarHovered ? 'sidebar-overlay-open' : 'sidebar-overlay-closed'
                            }`}
                        onMouseEnter={handleSidebarEnter}
                        onMouseLeave={handleSidebarLeave}
                    >
                        {sidebarBrandHeader(true)}
                        {sidebarNavContent}
                    </aside>
                </>
            )}

            {/* ═════════ MAIN CONTENT ═════════ */}
            <div className={`flex min-w-0 flex-1 flex-col transition-[margin] duration-300 ease-in-out ${!sidebarLocked ? 'md:ml-[52px]' : ''} ${!topbarLocked ? 'topbar-collapsed' : ''}`}>
                <header 
                    className="dashboard-topbar sticky top-0 z-30 border-b border-border/70 px-4 md:px-8"
                    style={{ position: 'relative' }}
                >
                    <div className="flex h-20 items-center gap-4 relative">
                        <button
                            className="rounded-2xl border border-border/70 bg-card/70 p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
                            onClick={() => setMobileOpen(true)}
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="4" x2="20" y1="12" y2="12" />
                                <line x1="4" x2="20" y1="6" y2="6" />
                                <line x1="4" x2="20" y1="18" y2="18" />
                            </svg>
                        </button>

                        <div className="dashboard-search flex h-14 flex-1 items-center rounded-[1.35rem] border border-border/70 px-4">
                            <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" x2="16.65" y1="21" y2="16.65" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search modules, records, contacts, activity..."
                                className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                            />
                            <div className="hidden rounded-xl border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:block">
                                Search
                            </div>
                        </div>

                        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                            <div className="shell-panel rounded-2xl p-1">
                                <ThemeToggle />
                            </div>

                            <div className="relative" ref={profileRef}>
                                <button
                                    onClick={() => setProfileOpen((prev) => !prev)}
                                    className="shell-panel flex items-center gap-3 rounded-2xl px-2.5 py-2 outline-none transition hover:border-border"
                                >
                                    <Avatar fallback={user?.displayName || user?.userName || 'User'} size="sm" className="bg-background" />
                                    <div className="hidden text-left sm:block">
                                        <p className="max-w-[124px] truncate text-sm font-medium">{user?.displayName || user?.userName || 'Workspace user'}</p>
                                        <p className="max-w-[124px] truncate text-xs text-muted-foreground">{user?.role || 'Team member'}</p>
                                    </div>
                                    <svg className={`h-4 w-4 text-muted-foreground transition-transform ${profileOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>

                                {profileOpen ? (
                                    <div className="profile-popover absolute right-0 top-[calc(100%+0.75rem)] w-[17rem] overflow-hidden rounded-3xl border border-border/80 p-2 shadow-2xl animate-slide-in-bottom">
                                        <div className="mb-2 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
                                            <p className="text-sm font-semibold">{user?.displayName || user?.userName}</p>
                                            <p className="text-xs text-muted-foreground">{user?.email || 'No email available'}</p>
                                        </div>
                                        <Link href="/permissions" onClick={() => setProfileOpen(false)} className="block rounded-2xl px-4 py-2.5 text-sm transition hover:bg-accent hover:text-accent-foreground">
                                            Access Control
                                        </Link>
                                        <div className="shell-divider my-2" />
                                        <div className="px-1" onClick={() => setProfileOpen(false)}>
                                            <LogoutButton />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </header>

                <main className="dashboard-content flex-1 overflow-hidden">
                    {pathname.startsWith('/inbox') ? (
                        <div className="h-full w-full">
                            {children}
                        </div>
                    ) : (
                        <div className="relative p-4 md:p-8">
                            <div className="mx-auto max-w-7xl">
                                {children}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* ═════════ MOBILE SIDEBAR ═════════ */}
            {mobileOpen ? (
                <>
                    <div className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
                    <aside className="dashboard-sidebar sidebar-surface fixed inset-y-0 left-0 z-50 flex w-[292px] flex-col shadow-2xl animate-slide-in-right">
                        <div className="flex h-20 items-center justify-between px-6">
                            <div className="flex items-center gap-3">
                                <div className="sidebar-brand-mark flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold text-primary-foreground">
                                    EH
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Company</p>
                                    <p className="text-base font-semibold">Enquiry Hub</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setMobileOpen(false)}
                                className="rounded-2xl border border-border/70 bg-card/70 p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                        {sidebarNavContent}
                    </aside>
                </>
            ) : null}
        </div>
    );
}
