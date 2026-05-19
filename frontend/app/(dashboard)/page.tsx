import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { getEnquiries, getEnquiryStats, type EnquiryListItem } from '@/services/messaging';

const STATUS_CONFIG: Record<string, { label: string; dotColor: string; accent: string }> = {
    NEW: { label: 'New', dotColor: 'bg-sky-500', accent: 'text-sky-600 dark:text-sky-300' },
    OPEN: { label: 'Open', dotColor: 'bg-emerald-500', accent: 'text-emerald-600 dark:text-emerald-300' },
    IN_PROGRESS: { label: 'In Progress', dotColor: 'bg-cyan-500', accent: 'text-cyan-600 dark:text-cyan-300' },
    AWAITING_CUSTOMER: { label: 'Awaiting Customer', dotColor: 'bg-amber-500', accent: 'text-amber-600 dark:text-amber-300' },
    QUOTATION_SENT: { label: 'Quotation Sent', dotColor: 'bg-violet-500', accent: 'text-violet-600 dark:text-violet-300' },
    FOLLOW_UP: { label: 'Follow Up', dotColor: 'bg-orange-500', accent: 'text-orange-600 dark:text-orange-300' },
    STALE: { label: 'Stale', dotColor: 'bg-slate-400', accent: 'text-slate-600 dark:text-slate-300' },
    CONVERTED: { label: 'Converted', dotColor: 'bg-emerald-600', accent: 'text-emerald-700 dark:text-emerald-300' },
    CLOSED_LOST: { label: 'Closed Lost', dotColor: 'bg-rose-500', accent: 'text-rose-600 dark:text-rose-300' },
};

const SOURCE_CONFIG: Record<string, { label: string; tone: string }> = {
    WHATSAPP: { label: 'WhatsApp', tone: 'text-emerald-600 dark:text-emerald-300' },
    EMAIL: { label: 'Email', tone: 'text-sky-600 dark:text-sky-300' },
    SMS: { label: 'SMS', tone: 'text-amber-600 dark:text-amber-300' },
    MANUAL: { label: 'Manual', tone: 'text-slate-600 dark:text-slate-300' },
};

function formatCompactNumber(value: number) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number) {
    return `${Math.round(value)}%`;
}

function timeAgo(dateInput: string | null | undefined) {
    if (!dateInput) {
        return 'No activity yet';
    }

    const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(dateInput).getTime()) / 60000));
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(dateInput));
}

function getPriorityLabel(priority: number | null) {
    if (priority === null || priority === undefined) return 'Standard';
    if (priority >= 8) return 'Critical';
    if (priority >= 5) return 'High';
    if (priority >= 3) return 'Medium';
    return 'Low';
}

function getAttentionReason(item: EnquiryListItem) {
    if (!item.assignedTo) return 'Needs owner';
    if (item.status === 'STALE') return 'Stalled conversation';
    if (item.status === 'AWAITING_CUSTOMER') return 'Waiting on customer';
    if ((item.priority ?? 0) >= 8) return 'Critical priority';
    return 'Monitor closely';
}

export default async function DashboardPage() {
    const [stats, enquiryResult] = await Promise.all([
        getEnquiryStats().catch(() => null),
        getEnquiries({ limit: 12, page: 1 }).catch(() => null),
    ]);

    if (!stats) {
        return (
            <div className="page-container">
                <Card className="rounded-[1.75rem] border-border/70">
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        Unable to load dashboard stats. Verify the backend API and auth token configuration.
                    </CardContent>
                </Card>
            </div>
        );
    }

    const enquiries = enquiryResult?.items ?? [];
    const statusEntries = Object.entries(STATUS_CONFIG).map(([status, config]) => ({
        status,
        ...config,
        count: stats.byStatus?.[status] ?? 0,
    }));
    const totalTracked = statusEntries.reduce((sum, item) => sum + item.count, 0);
    const activeWork = (stats.byStatus?.NEW ?? 0) + (stats.byStatus?.OPEN ?? 0) + (stats.byStatus?.IN_PROGRESS ?? 0);
    const followThrough = (stats.byStatus?.FOLLOW_UP ?? 0) + (stats.byStatus?.AWAITING_CUSTOMER ?? 0) + (stats.byStatus?.QUOTATION_SENT ?? 0);
    const conversionRate = totalTracked > 0 ? ((stats.byStatus?.CONVERTED ?? 0) / totalTracked) * 100 : 0;
    const ownershipRate = stats.totalOpen > 0 ? ((stats.totalOpen - stats.unassigned) / stats.totalOpen) * 100 : 100;
    const staleCount = stats.byStatus?.STALE ?? 0;
    const criticalQueue = enquiries
        .filter((item) => !item.assignedTo || item.status === 'STALE' || (item.priority ?? 0) >= 8)
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .slice(0, 4);
    const recentQueue = [...enquiries]
        .sort((left, right) => new Date(right.lastActivityAt || right.createdAt).getTime() - new Date(left.lastActivityAt || left.createdAt).getTime())
        .slice(0, 6);
    const teamLoad = Object.values(
        enquiries.reduce<Record<string, { label: string; count: number }>>((acc, item) => {
            const key = item.assignedTo?.id ?? 'unassigned';
            const label = item.assignedTo?.displayName || item.assignedTo?.userName || 'Unassigned';
            acc[key] = acc[key]
                ? { ...acc[key], count: acc[key].count + 1 }
                : { label, count: 1 };
            return acc;
        }, {}),
    )
        .sort((left, right) => right.count - left.count)
        .slice(0, 4);

    return (
        <div className="page-container">
            <section className="ops-hero overflow-hidden rounded-[2rem] border border-white/10 px-6 py-7 text-white shadow-2xl md:px-8 md:py-8">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.9fr)]">
                    <div className="space-y-6">
                        <div className="flex flex-wrap items-center gap-3">
                            <Badge className="w-fit border-white/10 bg-white/10 text-white">Control center</Badge>
                            <span className="inline-flex items-center gap-2 text-sm text-white/72">
                                <span className="pulse-dot bg-emerald-400" />
                                Live operating view
                            </span>
                        </div>

                        <div className="max-w-3xl space-y-3">
                            <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
                                A dashboard should reduce hesitation, not add visual noise.
                            </h1>
                            <p className="max-w-2xl text-sm leading-6 text-white/74 md:text-base">
                                This surface prioritizes ownership, queue pressure, and next actions first, so a team lead can scan the system in seconds and move directly into the right workflow.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="metric-tile">
                                <span className="metric-label">Open work</span>
                                <strong className="metric-value">{formatCompactNumber(stats.totalOpen)}</strong>
                                <span className="metric-meta">Current active enquiries</span>
                            </div>
                            <div className="metric-tile">
                                <span className="metric-label">Today intake</span>
                                <strong className="metric-value">{formatCompactNumber(stats.totalToday)}</strong>
                                <span className="metric-meta">Fresh demand since midnight</span>
                            </div>
                            <div className="metric-tile">
                                <span className="metric-label">Ownership</span>
                                <strong className="metric-value">{formatPercent(ownershipRate)}</strong>
                                <span className="metric-meta">{stats.unassigned} need assignment</span>
                            </div>
                            <div className="metric-tile">
                                <span className="metric-label">Conversion</span>
                                <strong className="metric-value">{formatPercent(conversionRate)}</strong>
                                <span className="metric-meta">{stats.byStatus?.CONVERTED ?? 0} won this cycle</span>
                            </div>
                        </div>
                    </div>

                    <div className="ops-glass rounded-[1.75rem] border border-white/10 p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-medium uppercase tracking-[0.26em] text-white/48">Executive signal</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">What needs action now</h2>
                            </div>
                            <Link
                                href="/enquiry"
                                className="rounded-full border border-white/14 px-3 py-1.5 text-xs font-medium text-white/78 transition hover:bg-white/10 hover:text-white"
                            >
                                Open queue
                            </Link>
                        </div>

                        <div className="mt-6 space-y-4">
                            <div className="rounded-[1.5rem] border border-white/10 bg-black/14 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-white/68">Primary pressure</p>
                                        <p className="mt-2 text-xl font-semibold">
                                            {stats.unassigned > 0 ? `${stats.unassigned} enquiries need ownership` : 'The queue is staffed and assigned'}
                                        </p>
                                    </div>
                                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/78">
                                        {stats.unassigned > 0 ? 'Assign now' : 'Healthy'}
                                    </span>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-white/60">
                                    Keep the first response chain moving by routing new or stalled conversations before they age into follow-up debt.
                                </p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                                    <p className="text-xs uppercase tracking-[0.22em] text-white/46">Active work</p>
                                    <p className="mt-2 text-2xl font-semibold">{activeWork}</p>
                                    <p className="mt-1 text-xs text-white/58">New, open, and in progress</p>
                                </div>
                                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                                    <p className="text-xs uppercase tracking-[0.22em] text-white/46">Follow-through</p>
                                    <p className="mt-2 text-2xl font-semibold">{followThrough}</p>
                                    <p className="mt-1 text-xs text-white/58">Awaiting reply, quote, or follow-up</p>
                                </div>
                                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                                    <p className="text-xs uppercase tracking-[0.22em] text-white/46">Stalled</p>
                                    <p className="mt-2 text-2xl font-semibold">{staleCount}</p>
                                    <p className="mt-1 text-xs text-white/58">Requires recovery before loss risk rises</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
                <Card className="insight-card rounded-[1.75rem] border-border/70">
                    <CardHeader className="flex flex-row items-center justify-between gap-3 pb-4">
                        <div>
                            <CardTitle className="text-lg">Pipeline by outcome</CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">Fast scan of where the queue is accumulating and where it is converting.</p>
                        </div>
                        <Link href="/permissions" className="text-sm text-muted-foreground transition hover:text-foreground">
                            Manage access
                        </Link>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {statusEntries.map((item) => {
                            const width = totalTracked > 0 ? Math.max(6, (item.count / totalTracked) * 100) : 0;

                            return (
                                <Link
                                    key={item.status}
                                    href={`/enquiry?status=${item.status}`}
                                    className="group grid gap-3 rounded-[1.25rem] border border-border/60 px-4 py-3 transition hover:border-border hover:bg-accent/30 md:grid-cols-[11rem_minmax(0,1fr)_4rem]"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className={`h-2.5 w-2.5 rounded-full ${item.dotColor}`} />
                                        <div>
                                            <p className="text-sm font-medium">{item.label}</p>
                                            <p className="text-xs text-muted-foreground">Status bucket</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="metric-bar">
                                            <span style={{ width: `${width}%` }} />
                                        </div>
                                        <p className="min-w-14 text-right text-xs text-muted-foreground">{totalTracked > 0 ? formatPercent((item.count / totalTracked) * 100) : '0%'}</p>
                                    </div>
                                    <div className={`text-right text-lg font-semibold tabular-nums ${item.accent}`}>{item.count}</div>
                                </Link>
                            );
                        })}
                    </CardContent>
                </Card>

                <Card className="insight-card rounded-[1.75rem] border-border/70">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-lg">Operating posture</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">A compact read on workload balance and system discipline.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
                            <p className="text-sm font-medium">Ownership discipline</p>
                            <div className="mt-3 flex items-end justify-between gap-3">
                                <strong className="text-3xl font-semibold tracking-tight">{formatPercent(ownershipRate)}</strong>
                                <span className="text-xs text-muted-foreground">Assigned coverage</span>
                            </div>
                            <div className="metric-bar mt-3">
                                <span style={{ width: `${Math.max(8, ownershipRate)}%` }} />
                            </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
                            <p className="text-sm font-medium">Conversion pace</p>
                            <div className="mt-3 flex items-end justify-between gap-3">
                                <strong className="text-3xl font-semibold tracking-tight">{formatPercent(conversionRate)}</strong>
                                <span className="text-xs text-muted-foreground">Closed won share</span>
                            </div>
                            <div className="metric-bar mt-3">
                                <span style={{ width: `${Math.max(8, conversionRate)}%` }} />
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
                                <p className="text-sm font-medium">Unassigned risk</p>
                                <p className="mt-2 text-2xl font-semibold tabular-nums">{stats.unassigned}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Records without a clear owner.</p>
                            </div>
                            <div className="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
                                <p className="text-sm font-medium">Stale recovery</p>
                                <p className="mt-2 text-2xl font-semibold tabular-nums">{staleCount}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Conversations needing intervention.</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <Card className="insight-card rounded-[1.75rem] border-border/70">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-lg">Priority queue</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">These conversations are the fastest path to better response quality and lower leakage.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {criticalQueue.length > 0 ? (
                            criticalQueue.map((item) => {
                                const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;
                                const source = SOURCE_CONFIG[item.source] || { label: item.source, tone: 'text-muted-foreground' };

                                return (
                                    <Link
                                        key={item.id}
                                        href={`/enquiry/${item.id}`}
                                        className="group flex flex-col gap-4 rounded-[1.35rem] border border-border/60 px-4 py-4 transition hover:-translate-y-0.5 hover:border-border hover:bg-accent/25 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-base font-semibold tracking-tight">{item.name}</p>
                                                <Badge variant="outline" className="border-border/70 bg-background/70 text-xs">
                                                    {getPriorityLabel(item.priority)}
                                                </Badge>
                                                <span className={`text-xs font-medium ${source.tone}`}>{source.label}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                <span>{getAttentionReason(item)}</span>
                                                <span>{item.assignedTo?.displayName || item.assignedTo?.userName || 'Unassigned'}</span>
                                                <span>{timeAgo(item.lastActivityAt || item.createdAt)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-xs text-muted-foreground">Status</p>
                                                <p className="mt-1 text-sm font-medium">{status.label}</p>
                                            </div>
                                            <span className={`h-2.5 w-2.5 rounded-full ${status.dotColor}`} />
                                        </div>
                                    </Link>
                                );
                            })
                        ) : (
                            <div className="rounded-[1.35rem] border border-dashed border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
                                No high-risk records surfaced from the latest queue sample.
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="insight-card rounded-[1.75rem] border-border/70">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-lg">Team distribution</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">A quick balance check across the latest assigned records.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {teamLoad.length > 0 ? (
                            teamLoad.map((member) => {
                                const width = enquiries.length > 0 ? (member.count / enquiries.length) * 100 : 0;

                                return (
                                    <div key={member.label} className="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-medium">{member.label}</p>
                                                <p className="text-xs text-muted-foreground">Visible workload</p>
                                            </div>
                                            <p className="text-lg font-semibold tabular-nums">{member.count}</p>
                                        </div>
                                        <div className="metric-bar mt-3">
                                            <span style={{ width: `${Math.max(10, width)}%` }} />
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="rounded-[1.25rem] border border-dashed border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
                                Team workload becomes visible here once enquiry assignments are present.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </section>

            <Card className="insight-card rounded-[1.75rem] border-border/70">
                <CardHeader className="flex flex-col gap-2 pb-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <CardTitle className="text-lg">Live queue</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">Recent conversation activity with enough metadata to decide whether to inspect or let it ride.</p>
                    </div>
                    <Link href="/enquiry" className="text-sm text-muted-foreground transition hover:text-foreground">
                        View all enquiries
                    </Link>
                </CardHeader>
                <CardContent className="space-y-3">
                    {recentQueue.length > 0 ? (
                        recentQueue.map((item) => {
                            const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;
                            const source = SOURCE_CONFIG[item.source] || { label: item.source, tone: 'text-muted-foreground' };

                            return (
                                <Link
                                    key={item.id}
                                    href={`/enquiry/${item.id}`}
                                    className="group grid gap-3 rounded-[1.25rem] border border-border/60 px-4 py-4 transition hover:border-border hover:bg-accent/25 md:grid-cols-[minmax(0,1.4fr)_9rem_10rem_7rem]"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="truncate text-sm font-semibold">{item.name}</p>
                                            <span className={`text-xs font-medium ${source.tone}`}>{source.label}</span>
                                        </div>
                                        <p className="mt-1 truncate text-sm text-muted-foreground">
                                            {item.email || item.phone || 'No contact details captured'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`h-2.5 w-2.5 rounded-full ${status.dotColor}`} />
                                        <span className="text-sm">{status.label}</span>
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {item.assignedTo?.displayName || item.assignedTo?.userName || 'Unassigned'}
                                    </div>
                                    <div className="text-right text-sm text-muted-foreground">
                                        {timeAgo(item.lastActivityAt || item.createdAt)}
                                    </div>
                                </Link>
                            );
                        })
                    ) : (
                        <div className="rounded-[1.25rem] border border-dashed border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
                            No recent enquiries are available from the current API response.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
