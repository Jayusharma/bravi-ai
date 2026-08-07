import { ReactNode } from 'react';

export type NavSection = 'inbox' | 'people' | 'templates' | 'analytics' | 'administration';

export interface NavItem {
    href: string;
    label: string;
    section: NavSection;
    icon?: ReactNode;
    permission: { action: string; subject: string };
    badgeKey?: 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'total';
    channelType?: 'whatsapp' | 'email' | 'instagram' | 'facebook';
    children?: Omit<NavItem, 'section' | 'icon'>[];
}

const icon = (path: ReactNode) => (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {path}
    </svg>
);

export const NAV_ITEMS: NavItem[] = [
    // ── INBOX CHANNELS ──
    {
        href: '/inbox/whatsapp',
        label: 'WhatsApp',
        section: 'inbox',
        badgeKey: 'whatsapp',
        channelType: 'whatsapp',
        permission: { action: 'read', subject: 'enquiry' },
    },
    {
        href: '/inbox/email',
        label: 'Email',
        section: 'inbox',
        badgeKey: 'email',
        channelType: 'email',
        permission: { action: 'read', subject: 'enquiry' },
    },
    {
        href: '/inbox/instagram',
        label: 'Instagram',
        section: 'inbox',
        badgeKey: 'instagram',
        channelType: 'instagram',
        permission: { action: 'read', subject: 'enquiry' },
    },
    {
        href: '/inbox/facebook',
        label: 'Facebook',
        section: 'inbox',
        badgeKey: 'facebook',
        channelType: 'facebook',
        permission: { action: 'read', subject: 'enquiry' },
    },

    // ── PEOPLE ──
    {
        href: '/contacts',
        label: 'Contacts',
        section: 'people',
        icon: icon(
            <>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>,
        ),
        permission: { action: 'read', subject: 'contact' },
    },

    // ── TEMPLATES ──
    {
        href: '/templates',
        label: 'Message Templates',
        section: 'templates',
        icon: icon(
            <>
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
            </>,
        ),
        permission: { action: 'read', subject: 'messagetemplate' },
    },

    // ── ANALYTICS ──
    {
        href: '/dashboard',
        label: 'Dashboard',
        section: 'analytics',
        icon: icon(
            <>
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
            </>,
        ),
        permission: { action: 'read', subject: 'dashboard' },
    },

    // ── ADMINISTRATION ──
    {
        href: '/permissions',
        label: 'Team',
        section: 'administration',
        icon: icon(
            <>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>,
        ),
        permission: { action: 'read', subject: 'permission' },
    },
    {
        href: '/permissions',
        label: 'Access Control',
        section: 'administration',
        icon: icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
        permission: { action: 'read', subject: 'permission' },
    },
    {
        href: '/channels',
        label: 'Channels',
        section: 'administration',
        icon: icon(
            <>
                <path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                <path d="M22 12h-6a2 2 0 0 0 0 4h4" />
                <path d="M18 9v-2" />
            </>,
        ),
        permission: { action: 'read', subject: 'channelconnection' },
    },
    {
        href: '/admin',
        label: 'Settings',
        section: 'administration',
        icon: icon(
            <>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1e-2a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </>,
        ),
        permission: { action: 'read', subject: 'permission' },
    },
];

export function getNavBySection(items: NavItem[], section: NavSection): NavItem[] {
    return items.filter((item) => item.section === section);
}

