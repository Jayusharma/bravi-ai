import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Dashboard - Enquiry Hub',
    description: 'Your central command center for managing enquiries, team activity, and operational metrics.',
};

export default function DashboardPage() {
    return (
        <div className="page-container">
            <div className="flex min-h-[70vh] items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-border/70 bg-card/50 mx-auto">
                        <svg className="h-9 w-9 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="7" height="9" x="3" y="3" rx="1" />
                            <rect width="7" height="5" x="14" y="3" rx="1" />
                            <rect width="7" height="9" x="14" y="12" rx="1" />
                            <rect width="7" height="5" x="3" y="16" rx="1" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                        Your central command center. Navigate using the sidebar to access enquiries, team management, and access control.
                    </p>
                </div>
            </div>
        </div>
    );
}
