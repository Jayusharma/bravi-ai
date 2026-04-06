import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { getEnquiries } from '@/services/enquiry.service';
import { PermissionGate } from '@/components/auth';
import Link from 'next/link';

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'; dotColor: string }> = {
  NEW: { label: 'New', variant: 'default', dotColor: 'bg-blue-500' },
  OPEN: { label: 'Open', variant: 'success', dotColor: 'bg-green-500' },
  IN_PROGRESS: { label: 'In Progress', variant: 'default', dotColor: 'bg-violet-500' },
  AWAITING_CUSTOMER: { label: 'Awaiting', variant: 'warning', dotColor: 'bg-amber-500' },
  QUOTATION_SENT: { label: 'Quotation Sent', variant: 'secondary', dotColor: 'bg-purple-500' },
  FOLLOW_UP: { label: 'Follow Up', variant: 'warning', dotColor: 'bg-orange-500' },
  STALE: { label: 'Stale', variant: 'outline', dotColor: 'bg-gray-400' },
  CONVERTED: { label: 'Converted', variant: 'success', dotColor: 'bg-emerald-500' },
  CLOSED_LOST: { label: 'Closed Lost', variant: 'destructive', dotColor: 'bg-red-500' },
};

const CHANNEL_ICONS: Record<string, { icon: string; label: string }> = {
  WHATSAPP: { icon: '💬', label: 'WhatsApp' },
  EMAIL: { icon: '✉️', label: 'Email' },
  SMS: { icon: '📱', label: 'SMS' },
  MANUAL: { icon: '✍️', label: 'Manual' },
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const status = params?.status || '';
  const source = params?.source || '';
  const search = params?.search || '';
  const page = parseInt(params?.page || '1', 10);

  const result = await getEnquiries({
    status: status || undefined,
    source: source || undefined,
    search: search || undefined,
    page,
    limit: 20,
  }).catch(() => ({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
  const enquiries = result.items;
  const meta = result.meta;

  return (
    <div className="page-container">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Enquiries</h1>
          <p className="page-description">
            {meta.total} total · Page {meta.page} of {meta.totalPages || 1}
          </p>
        </div>
        <PermissionGate action="create" subject="enquiry">
          <Link href="/enquiry/new">
            <Button className="gap-2">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              New Enquiry
            </Button>
          </Link>
        </PermissionGate>
      </div>

      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <Input name="search" defaultValue={search} placeholder="Name, email, phone..." className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select name="status" defaultValue={status} className="h-9 w-40">
                <option value="">All Statuses</option>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Select name="source" defaultValue={source} className="h-9 w-36">
                <option value="">All Sources</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </Select>
            </div>
            <Button type="submit" variant="default" className="h-9">Filter</Button>
            {(status || source || search) ? (
              <Link href="/enquiry">
                <Button type="button" variant="outline" className="h-9">Clear</Button>
              </Link>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[280px]">Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead className="text-right">Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enquiries.map((enquiry) => {
                const statusCfg = STATUS_CONFIG[enquiry.status] || { label: enquiry.status, variant: 'outline' as const, dotColor: 'bg-gray-400' };
                const channelCfg = CHANNEL_ICONS[enquiry.source] || { icon: '📋', label: enquiry.source };

                return (
                  <TableRow key={enquiry.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/enquiry/${enquiry.id}`} className="group flex items-center gap-3">
                        <Avatar fallback={enquiry.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                            {enquiry.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {enquiry.email || enquiry.phone || 'No contact info'}
                          </p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{channelCfg.icon}</span>
                        {channelCfg.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusCfg.variant} className="gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dotColor}`} />
                        {statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {enquiry.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <Avatar fallback={enquiry.assignedTo.displayName || enquiry.assignedTo.userName} size="sm" />
                          <span className="truncate text-sm">
                            {enquiry.assignedTo.displayName || enquiry.assignedTo.userName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="tabular-nums text-sm text-muted-foreground">{enquiry.messageCount}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs text-muted-foreground">{timeAgo(enquiry.lastActivityAt || enquiry.createdAt)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}

              {enquiries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32">
                    <div className="flex flex-col items-center justify-center text-center">
                      <svg className="mb-2 h-8 w-8 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <p className="text-sm text-muted-foreground">No enquiries found</p>
                      <p className="mt-0.5 text-xs text-muted-foreground/60">Try adjusting your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {meta.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(meta.page - 1) * meta.limit + 1}-{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
          </p>
          <div className="flex gap-2">
            {meta.page > 1 ? (
              <Link href={`/enquiry?page=${meta.page - 1}${status ? `&status=${status}` : ''}${source ? `&source=${source}` : ''}${search ? `&search=${search}` : ''}`}>
                <Button variant="outline" className="h-9 gap-1">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Previous
                </Button>
              </Link>
            ) : null}
            {meta.page < meta.totalPages ? (
              <Link href={`/enquiry?page=${meta.page + 1}${status ? `&status=${status}` : ''}${source ? `&source=${source}` : ''}${search ? `&search=${search}` : ''}`}>
                <Button variant="outline" className="h-9 gap-1">
                  Next
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
