import { ReactNode } from 'react';

export interface NavItem {
    href: string;
    label: string;
    section: 'platform' | 'settings';
    icon?: ReactNode;
    permission: { action: string; subject: string };
    children?: Omit<NavItem, 'section' | 'icon'>[];
}

const icon = (path: ReactNode) => (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {path}
    </svg>
);

export const NAV_ITEMS: NavItem[] = [
    {
        href: '/dashboard',
        label: 'Dashboard',
        section: 'platform',
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
    {
        href: '/enquiry',
        label: 'Enquiries',
        section: 'platform',
        icon: icon(
            <>
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" x2="8" y1="13" y2="13" />
                <line x1="16" x2="8" y1="17" y2="17" />
            </>,
        ),
        permission: { action: 'read', subject: 'enquiry' },
    },
    {
        href: '/users',
        label: 'Team',
        section: 'platform',
        icon: icon(
            <>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>,
        ),
        permission: { action: 'read', subject: 'user' },
    },
    {
        href: '/permissions',
        label: 'Access Control',
        section: 'settings',
        icon: icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
        permission: { action: 'read', subject: 'permission' },
    },
];

export function getNavBySection(items: NavItem[], section: NavItem['section']): NavItem[] {
    return items.filter((item) => item.section === section);
}
