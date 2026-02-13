import { serverFetch } from '@/lib/ServerApi';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from "@/components/ui/Card";
import Link from 'next/link';

interface Stats {
    totalEnquiries: number;
    newToday: number;
    unassigned: number;
    pendingFollowUps: number;
    conversionRate: number;
    statusBreakdown: Record<string, number>;
}

export default async function DashboardPage() {
    let stats: Stats | null = null;
    try {
        stats = await serverFetch('/enquiry/stats');
    } catch (e) {
        console.error("Failed to fetch stats", e);
    }

    const statCards = stats ? [
        {
            label: 'Total Enquiries',
            value: stats.totalEnquiries,
            icon: '📋',
            color: 'from-blue-500/10 to-blue-500/5 border-blue-500/20',
            textColor: 'text-blue-500',
        },
        {
            label: 'New Today',
            value: stats.newToday,
            icon: '🆕',
            color: 'from-green-500/10 to-green-500/5 border-green-500/20',
            textColor: 'text-green-500',
        },
        {
            label: 'Unassigned',
            value: stats.unassigned,
            icon: '⚠️',
            color: 'from-orange-500/10 to-orange-500/5 border-orange-500/20',
            textColor: 'text-orange-500',
        },
        {
            label: 'Pending Follow-ups',
            value: stats.pendingFollowUps,
            icon: '🔔',
            color: 'from-purple-500/10 to-purple-500/5 border-purple-500/20',
            textColor: 'text-purple-500',
        },
        {
            label: 'Conversion Rate',
            value: `${stats.conversionRate}%`,
            icon: '📈',
            color: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20',
            textColor: 'text-emerald-500',
        },
    ] : [];

    const getStatusLabel = (status: string) => {
        const labels: Record<string, string> = {
            NEW: '🔵 New',
            OPEN: '🟢 Open',
            FOLLOW_UP: '🟡 Follow Up',
            QUOTATION_SENT: '📨 Quotation Sent',
            CONVERTED: '✅ Converted',
            CLOSED_LOST: '❌ Closed (Lost)',
            CLOSED: '⚫ Closed',
        };
        return labels[status] || status;
    };

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-muted-foreground mt-1">
                        Overview of your enquiry pipeline
                    </p>
                </div>

                {/* KPI Cards */}
                {stats ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                            {statCards.map((card) => (
                                <Card key={card.label} className={`bg-gradient-to-br ${card.color} border`}>
                                    <CardContent className="p-5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-2xl">{card.icon}</span>
                                        </div>
                                        <div className="mt-3">
                                            <p className={`text-2xl font-bold ${card.textColor}`}>
                                                {card.value}
                                            </p>
                                            <p className="text-sm text-muted-foreground mt-0.5">{card.label}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>

                        {/* Status Breakdown */}
                        <Card>
                            <CardContent className="p-6">
                                <h2 className="text-lg font-semibold mb-4">Status Breakdown</h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {Object.entries(stats.statusBreakdown).map(([status, count]) => (
                                        <div key={status} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                            <span className="text-sm">{getStatusLabel(status)}</span>
                                            <span className="font-semibold text-lg">{count}</span>
                                        </div>
                                    ))}
                                    {Object.keys(stats.statusBreakdown).length === 0 && (
                                        <p className="text-muted-foreground col-span-full">No enquiries yet</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Quick Actions */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <Link href="/enquiry" className="block">
                                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                                    <CardContent className="p-5">
                                        <div className="text-xl mb-2">📋</div>
                                        <h3 className="font-semibold">View All Enquiries</h3>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Browse, filter, and manage enquiries
                                        </p>
                                    </CardContent>
                                </Card>
                            </Link>
                            <Link href="/users" className="block">
                                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                                    <CardContent className="p-5">
                                        <div className="text-xl mb-2">👥</div>
                                        <h3 className="font-semibold">Manage Users</h3>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Add, edit, and assign roles to team members
                                        </p>
                                    </CardContent>
                                </Card>
                            </Link>
                            <Link href="/enquiry?status=NEW" className="block">
                                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                                    <CardContent className="p-5">
                                        <div className="text-xl mb-2">🆕</div>
                                        <h3 className="font-semibold">New Enquiries</h3>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Review and assign unhandled enquiries
                                        </p>
                                    </CardContent>
                                </Card>
                            </Link>
                        </div>
                    </>
                ) : (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <p className="text-muted-foreground">
                                Unable to load dashboard stats. Make sure the backend is running.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </DashboardLayout>
    );
}
