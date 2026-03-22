import { ReactNode } from 'react';

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                    NAVIGATION CONFIG                              ║
 * ║  Single source of truth for all sidebar/nav items.               ║
 * ║  Each item has a permission requirement — the sidebar            ║
 * ║  only shows items the user's DB permissions allow.               ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

export interface NavItem {
    href: string;
    label: string;
    section: 'platform' | 'settings';
    icon: ReactNode;
    permission: { action: string; subject: string };
}

// ── Icons as components for reuse ──

const DashboardIcon = (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
);

const EnquiryIcon = (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" />
    </svg>
);

const TeamIcon = (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const SettingsIcon = (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
    </svg>
);

// ═══════════════════════════════════════════════════════════════════
// ALL NAVIGATION ITEMS
// Add new pages here. The sidebar will automatically show/hide
// based on the user's DB permissions.
// ═══════════════════════════════════════════════════════════════════

export const NAV_ITEMS: NavItem[] = [
    // ── Platform section ──
    {
        href: '/dashboard',
        label: 'Dashboard',
        section: 'platform',
        icon: DashboardIcon,
        permission: { action: 'read', subject: 'dashboard' },
    },
    {
        href: '/enquiry',
        label: 'Enquiries',
        section: 'platform',
        icon: EnquiryIcon,
        permission: { action: 'read', subject: 'enquiry' },
    },
    {
        href: '/users',
        label: 'Team',
        section: 'platform',
        icon: TeamIcon,
        permission: { action: 'read', subject: 'user' },
    },

    // ── Settings section ──
    // {
    //   href: '/settings',
    //   label: 'Settings',
    //   section: 'settings',
    //   icon: SettingsIcon,
    //   permission: { action: 'manage', subject: 'all' },
    // },
];

/**
 * Filter nav items by section.
 */
export function getNavBySection(items: NavItem[], section: NavItem['section']): NavItem[] {
    return items.filter((item) => item.section === section);
}
