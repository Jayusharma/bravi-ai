import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { getEnquiryStats } from '@/services/enquiry.service';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { WelcomeMessage } from '@/components/dashboard/WelcomeMessage';
import Link from 'next/link';

export default async function DashboardPage() {
    const stats = await getEnquiryStats().catch(() => null);

    const statusConfig: Record<string, { label: string; dotColor: string }> = {
        NEW: { label: 'New', dotColor: 'bg-blue-500' },
        OPEN: { label: 'Open', dotColor: 'bg-green-500' },
        IN_PROGRESS: { label: 'In Progress', dotColor: 'bg-violet-500' },
        AWAITING_CUSTOMER: { label: 'Awaiting', dotColor: 'bg-amber-500' },
        QUOTATION_SENT: { label: 'Quotation', dotColor: 'bg-purple-500' },
        FOLLOW_UP: { label: 'Follow Up', dotColor: 'bg-orange-500' },
        STALE: { label: 'Stale', dotColor: 'bg-gray-400' },
        CONVERTED: { label: 'Converted', dotColor: 'bg-emerald-500' },
        CLOSED_LOST: { label: 'Closed Lost', dotColor: 'bg-red-500' },
    };

    return (
        <DashboardLayout>
            <div className="page-container">
                {/* ── Header ── */}
                <div className="page-header">
                    <h1 className="page-title">Dashboard</h1>
                    <WelcomeMessage />
                </div>

                {stats ? (
                    <>
                        {/* ── KPI Cards ── */}
                        <div className="card-grid-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">
                                        Total Open
                                    </CardTitle>
                                    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                                    </svg>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{stats.totalOpen}</div>
                                    <p className="text-xs text-muted-foreground mt-1">Active enquiries</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">
                                        New Today
                                    </CardTitle>
                                    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 5v14" /><path d="M5 12h14" />
                                    </svg>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{stats.totalToday}</div>
                                    <p className="text-xs text-muted-foreground mt-1">Added today</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">
                                        Unassigned
                                    </CardTitle>
                                    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                                    </svg>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.unassigned}</div>
                                    <p className="text-xs text-muted-foreground mt-1">Needs attention</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">
                                        Converted
                                    </CardTitle>
                                    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.byStatus?.CONVERTED || 0}</div>
                                    <p className="text-xs text-muted-foreground mt-1">Successfully closed</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* ── Pipeline Overview ── */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Pipeline Overview</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="card-grid-5">
                                    {Object.entries(statusConfig).map(([status, config]) => {
                                        const count = stats.byStatus?.[status] || 0;
                                        return (
                                            <Link key={status} href={`/enquiry?status=${status}`} className="group">
                                                <div className="flex items-center justify-between p-3 rounded-lg border border-transparent hover:border-border hover:bg-accent/50 transition-all">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className={`h-2 w-2 rounded-full ${config.dotColor}`} />
                                                        <span className="text-sm truncate">{config.label}</span>
                                                    </div>
                                                    <span className="text-sm font-semibold tabular-nums">{count}</span>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>

                        {/* ── Quick Actions (client component with PermissionGate) ── */}
                        <QuickActions />
                    </>
                ) : (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <svg className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                            </svg>
                            <p className="text-muted-foreground text-sm">
                                Unable to load dashboard stats. Make sure the backend is running.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </DashboardLayout>
    );
}
