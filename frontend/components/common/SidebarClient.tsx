'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogoutButton } from '@/components/auth';
import { Avatar } from '@/components/ui/Avatar';
import { ThemeToggle } from './ThemeToggle';
import { NAV_ITEMS, getNavBySection, type NavItem, type NavSection } from '@/lib/navigation';
import { useAuthStore } from '@/stores/auth-store';

import { useQueryClient } from '@tanstack/react-query';
import { ensureListeners } from '@/lib/socketListeners';
import { useUnreadSummary } from '@/hooks/useUnreadSummary';

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

    // Real-time channel badge counts — count of DISTINCT CONTACTS with unread messages,
    // not total unread message count. Single source of truth (useUnreadSummary); do not
    // compute this independently anywhere else — see InboxSidebar's header, which reads
    // the same hook rather than deriving its own count.
    const { data: unreadSummary } = useUnreadSummary();
    const channelCounts: Record<string, number> = useMemo(() => ({
        whatsapp: unreadSummary?.WHATSAPP ?? 0,
        email: unreadSummary?.EMAIL ?? 0,
    }), [unreadSummary]);

    // ── Collapsible section headers state (Inbox open by default, rest collapsed) ──
    const [collapsedSections, setCollapsedSections] = useState<Record<NavSection, boolean>>({
        inbox: false,
        people: true,
        templates: true,
        analytics: true,
        administration: true,
    });

    const toggleSectionCollapse = (section: NavSection) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [section]: !prev[section],
        }));
    };

    // ── Sidebar lock/unlock ──
    const [sidebarLocked, setSidebarLocked] = useState<boolean>(true);
    const [sidebarHovered, setSidebarHovered] = useState(false);

    // ── Sidebar width ──
    const [sidebarWidth, setSidebarWidth] = useState<number>(240);
    const isSidebarResizing = useRef(false);

    // ── Profile popover ──
    const [profileOpen, setProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement | null>(null);

    // ── Client-side settings hydration ──
    useEffect(() => {
        try {
            const storedSidebarLocked = localStorage.getItem('sidebar-locked');
            if (storedSidebarLocked !== null) {
                setSidebarLocked(storedSidebarLocked === 'true');
            }

            const storedSidebarWidth = localStorage.getItem('sidebar-width');
            if (storedSidebarWidth) {
                setSidebarWidth(Math.max(200, Math.min(320, parseInt(storedSidebarWidth, 10))));
            }
        } catch (err) {
            console.error('Failed to load sidebar settings from localStorage:', err);
        }
    }, []);

    const toggleSidebarLock = useCallback(() => {
        setSidebarLocked((prev) => {
            const next = !prev;
            localStorage.setItem('sidebar-locked', String(next));
            if (next) setSidebarHovered(false);
            return next;
        });
    }, []);

    // Instant hover handlers (zero lag/delay)
    const handleSidebarEnter = useCallback(() => {
        if (!sidebarLocked) {
            setSidebarHovered(true);
        }
    }, [sidebarLocked]);

    const handleSidebarLeave = useCallback(() => {
        if (!sidebarLocked) {
            setSidebarHovered(false);
        }
    }, [sidebarLocked]);

    const handleSidebarResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isSidebarResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isSidebarResizing.current) return;
            const newWidth = Math.min(320, Math.max(200, ev.clientX));
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

    const visibleNavItems = useMemo(() => {
        if (!isLoaded) return [];
        return NAV_ITEMS.filter((item) => can(item.permission.action, item.permission.subject));
    }, [can, isLoaded]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const inboxItems = getNavBySection(visibleNavItems, 'inbox');
    const peopleItems = getNavBySection(visibleNavItems, 'people');
    const templateItems = getNavBySection(visibleNavItems, 'templates');
    const analyticsItems = getNavBySection(visibleNavItems, 'analytics');
    const administrationItems = getNavBySection(visibleNavItems, 'administration');

    // Current expanded state
    const isExpanded = sidebarLocked || sidebarHovered;

    // Section Header Icons map
    const SECTION_ICONS: Record<NavSection, React.ReactNode> = {
        inbox: (
            <svg className="h-4 w-4 text-indigo-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
        ),
        people: (
            <svg className="h-4 w-4 text-emerald-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        templates: (
            <svg className="h-4 w-4 text-amber-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
            </svg>
        ),
        analytics: (
            <svg className="h-4 w-4 text-sky-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" x2="18" y1="20" y2="10" />
                <line x1="12" x2="12" y1="20" y2="4" />
                <line x1="6" x2="6" y1="20" y2="14" />
            </svg>
        ),
        administration: (
            <svg className="h-4 w-4 text-purple-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1e-2a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        ),
    };

    // Render SVG Channel Icon helper
    const renderChannelIcon = (type?: string) => {
        switch (type) {
            case 'whatsapp':
                return (
                    <svg className="h-4 w-4 text-emerald-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 2C6.477 2 2 6.477 2 12c0 2.15.68 4.14 1.84 5.77L2.5 21.5l3.87-1.3C7.94 21.28 9.89 21.94 12 21.94c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.06c-1.89 0-3.64-.56-5.11-1.52l-.37-.24-2.29.77.78-2.22-.26-.38A8.026 8.026 0 0 1 3.94 12c0-4.44 3.62-8.06 8.06-8.06s8.06 3.62 8.06 8.06-3.62 8.06-8.06 8.06z"/>
                    </svg>
                );
            case 'email':
                return (
                    <svg className="h-4 w-4 text-sky-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                );
            case 'instagram':
                return (
                    <svg className="h-4 w-4 text-pink-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                    </svg>
                );
            case 'facebook':
                return (
                    <svg className="h-4 w-4 text-blue-400 shrink-0 opacity-90" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                    </svg>
                );
            default:
                return null;
        }
    };

    // Render single nav link (Uniform DOM structure for 100% layout stability)
    const renderNavLink = (item: NavItem) => {
        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
        const badgeVal = item.badgeKey ? channelCounts[item.badgeKey] : undefined;

        return (
            <Link
                key={`${item.section}-${item.label}-${item.href}`}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`sidebar-nav-item flex items-center h-9 rounded-lg px-2.5 transition-all text-sm font-medium ${
                    isActive
                        ? 'sidebar-item-active text-white font-medium'
                        : 'text-slate-400 hover:bg-[#151928] hover:text-slate-200'
                }`}
                title={!isExpanded ? item.label : undefined}
            >
                {/* Left Icon (100% fixed X & Y position across modes) */}
                <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {item.channelType ? (
                        renderChannelIcon(item.channelType)
                    ) : (
                        <div className={isActive ? 'text-indigo-400' : 'text-slate-400'}>
                            {item.icon}
                        </div>
                    )}
                </div>

                {/* Right Text & Badge (Fades in/out smoothly without layout shift) */}
                <div
                    className={`flex flex-1 items-center justify-between min-w-0 ml-3 transition-opacity duration-200 ${
                        isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden pointer-events-none'
                    }`}
                >
                    <span className="truncate text-[13px]">{item.label}</span>
                    {badgeVal !== undefined && badgeVal > 0 ? (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                            {badgeVal}
                        </span>
                    ) : null}
                </div>
            </Link>
        );
    };

    // Render collapsible section header with Section Header Icon
    const renderNavSection = (sectionKey: NavSection, title: string, items: NavItem[]) => {
        if (items.length === 0) return null;
        const isSectionCollapsed = collapsedSections[sectionKey];

        return (
            <div className="space-y-1">
                {/* Section Header Button */}
                <button
                    onClick={() => toggleSectionCollapse(sectionKey)}
                    className="flex w-full items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-200 group cursor-pointer outline-none h-8 rounded-lg hover:bg-[#141724]"
                    title={!isExpanded ? title : undefined}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        {/* Section Header Icon (Fixed position at left in both modes) */}
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {SECTION_ICONS[sectionKey]}
                        </div>
                        {/* Section Title (Fades in/out) */}
                        <span className={`transition-opacity duration-200 truncate ${isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}`}>
                            {title}
                        </span>
                    </div>

                    {isExpanded ? (
                        <svg
                            className={`h-3 w-3 shrink-0 text-slate-500 transition-transform duration-200 group-hover:text-slate-300 ${
                                isSectionCollapsed ? '-rotate-90' : 'rotate-0'
                            }`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m6 9 6 6 6-6" />
                        </svg>
                    ) : null}
                </button>

                {/* Section Children (Slightly shifted right when expanded) */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isSectionCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'
                }`}>
                    <div className={`space-y-0.5 transition-all duration-200 ${
                        isExpanded ? 'pl-3' : ''
                    }`}>
                        {items.map((item) => renderNavLink(item))}
                    </div>
                </div>
            </div>
        );
    };

    // ── Header Area ──
    const sidebarHeader = (showLock: boolean) => (
        <div className="flex flex-col shrink-0">
            {/* Top Brand Row (Fixed 52px Height) */}
            <div className="flex h-13 items-center justify-between px-3 pt-3 pb-1">
                <div className="flex items-center gap-2 min-w-0">
                    <Link href="/dashboard" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-purple-500 text-white font-bold text-sm shadow-md shadow-indigo-500/20 outline-none select-none">
                        b
                    </Link>
                    <span className={`text-base font-bold tracking-tight text-white select-none whitespace-nowrap transition-opacity duration-200 ${
                        isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                    }`}>
                        ravi-ai
                    </span>
                </div>

                {showLock && isExpanded ? (
                    <button
                        onClick={toggleSidebarLock}
                        className="sidebar-lock-btn flex h-6 w-6 shrink-0 items-center justify-center text-slate-400 transition hover:text-white outline-none"
                        title={sidebarLocked ? 'Unlock sidebar' : 'Lock sidebar'}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="6.5" />
                            <circle cx="12" cy="12" r="2" fill="currentColor" />
                        </svg>
                    </button>
                ) : null}
            </div>

            {/* Search Bar Container */}
            <div className="px-2.5 py-1.5">
                <div
                    className="sidebar-search-box flex h-9 items-center rounded-lg px-2.5 text-xs text-slate-200 transition-all focus-within:bg-[#161928]"
                    style={{ border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: '#111420' }}
                >
                    <svg className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" x2="16.65" y1="21" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search"
                        className={`ml-2 w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500 transition-opacity duration-200 ${
                            isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                        }`}
                    />
                </div>
            </div>
        </div>
    );

    // ── Sidebar Navigation List ──
    const sidebarNavContent = (
        <nav className="flex-1 space-y-3 overflow-y-auto px-2.5 py-2 custom-scrollbar">
            {renderNavSection('inbox', 'Inbox', inboxItems)}
            {renderNavSection('people', 'People', peopleItems)}
            {renderNavSection('templates', 'Templates', templateItems)}
            {renderNavSection('analytics', 'Analytics', analyticsItems)}
            {renderNavSection('administration', 'Administration', administrationItems)}
        </nav>
    );

    // ── Bottom Profile Footer Card ──
    const sidebarProfileFooter = (
        <div className="relative p-2.5 mt-auto shrink-0" ref={profileRef}>
            <div
                className="flex h-11 items-center justify-between rounded-xl px-2.5 transition-all hover:bg-[#161928]"
                style={{
                    border: '1px solid rgba(255, 255, 255, 0.09)',
                    backgroundColor: '#111420',
                }}
            >
                <button
                    onClick={() => setProfileOpen((prev) => !prev)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
                >
                    <Avatar fallback={user?.displayName || user?.userName || 'Jay'} size="sm" className="bg-slate-700 text-white font-bold shrink-0" />
                    <div className={`min-w-0 flex-1 transition-opacity duration-200 ${
                        isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                    }`}>
                        <p className="truncate text-xs font-semibold text-white">{user?.displayName || user?.userName || 'Jay'}</p>
                        <p className="truncate text-[10px] text-slate-400 uppercase tracking-wider">{user?.role || 'Admin'}</p>
                    </div>
                </button>

                {isExpanded ? (
                    <button
                        onClick={() => setProfileOpen((prev) => !prev)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 transition hover:text-white bg-transparent outline-none p-1"
                        title="Notifications"
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                    </button>
                ) : null}
            </div>

            {profileOpen ? (
                <div
                    className="profile-popover absolute bottom-[calc(100%+0.5rem)] left-2 right-2 z-50 overflow-hidden rounded-xl p-2.5 shadow-2xl animate-slide-in-bottom text-slate-200"
                    style={{
                        backgroundColor: '#111420',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        minWidth: '200px',
                    }}
                >
                    <div
                        className="mb-2 rounded-lg bg-[#151928] px-3 py-2"
                        style={{ border: '1px solid rgba(255, 255, 255, 0.05)' }}
                    >
                        <p className="text-xs font-semibold text-white">{user?.displayName || user?.userName || 'Jay'}</p>
                        <p className="truncate text-[11px] text-slate-400">{user?.email || 'admin@example.com'}</p>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-300">
                        <span>Theme</span>
                        <ThemeToggle />
                    </div>
                    <Link
                        href="/permissions"
                        onClick={() => setProfileOpen(false)}
                        className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#1A1E2F] hover:text-white"
                    >
                        Access Control
                    </Link>
                    <div className="my-1.5" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }} />
                    <div className="px-1" onClick={() => setProfileOpen(false)}>
                        <LogoutButton />
                    </div>
                </div>
            ) : null}
        </div>
    );

    const currentWidth = sidebarLocked ? sidebarWidth : (sidebarHovered ? sidebarWidth : 60);

    return (
        <div className="dashboard-shell flex h-screen overflow-hidden bg-slate-950 text-slate-100">
            {/* ═════════ SINGLE UNIFIED SIDEBAR (Layout Stable) ═════════ */}
            <aside
                className={`dashboard-sidebar sidebar-surface sidebar-expanding hidden shrink-0 md:flex md:flex-col border-r border-slate-800/60 bg-[#0C0E17] ${
                    !sidebarLocked ? 'fixed inset-y-0 left-0 z-50' : 'relative'
                } ${!sidebarLocked && sidebarHovered ? 'shadow-2xl shadow-black/80' : ''}`}
                style={{ width: currentWidth }}
                onMouseEnter={handleSidebarEnter}
                onMouseLeave={handleSidebarLeave}
            >
                {sidebarHeader(true)}
                {sidebarNavContent}
                {sidebarProfileFooter}
            </aside>

            {/* Sidebar resize handle (only visible when locked) */}
            {sidebarLocked ? (
                <div
                    className="sidebar-resize-handle"
                    onMouseDown={handleSidebarResize}
                />
            ) : null}

            {/* ═════════ MAIN CONTENT ═════════ */}
            <div className={`flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-in-out ${!sidebarLocked ? 'md:ml-[60px]' : ''}`}>
                {/* Mobile Top Header (only on small screens) */}
                <div className="flex h-12 items-center justify-between border-b border-slate-800/80 bg-[#0C0E17] px-4 md:hidden">
                    <button
                        className="rounded-lg border border-slate-800 bg-[#141724] p-1.5 text-slate-300 transition hover:bg-[#1A1E2F]"
                        onClick={() => setMobileOpen(true)}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" x2="20" y1="12" y2="12" />
                            <line x1="4" x2="20" y1="6" y2="6" />
                            <line x1="4" x2="20" y1="18" y2="18" />
                        </svg>
                    </button>
                    <span className="text-xs font-semibold text-white">bravi-ai</span>
                    <div className="w-6" />
                </div>

                <main className={`dashboard-content flex-1 h-full w-full ${pathname.startsWith('/inbox') ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
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

            {/* ═════════ MOBILE SIDEBAR DRAWER ═════════ */}
            {mobileOpen ? (
                <>
                    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
                    <aside className="dashboard-sidebar sidebar-surface fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-slate-800 bg-[#0C0E17] shadow-2xl animate-slide-in-right">
                        <div className="flex items-center justify-between px-3 pt-3">
                            <span className="text-xs font-bold text-white">bravi-ai</span>
                            <button
                                onClick={() => setMobileOpen(false)}
                                className="rounded-lg border border-slate-800 bg-[#141724] p-1 text-slate-400 hover:text-white"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                        {sidebarHeader(false)}
                        {sidebarNavContent}
                        {sidebarProfileFooter}
                    </aside>
                </>
            ) : null}
        </div>
    );
}
