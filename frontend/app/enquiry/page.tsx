import { serverFetch } from '@/lib/ServerApi';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Card, CardContent } from "@/components/ui/Card";

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  OPEN: 'bg-green-500/10 text-green-600 border-green-500/20',
  FOLLOW_UP: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  QUOTATION_SENT: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  CONVERTED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  CLOSED_LOST: 'bg-red-500/10 text-red-600 border-red-500/20',
  CLOSED: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

const SOURCE_ICONS: Record<string, string> = {
  WHATSAPP: '💬',
  EMAIL: '📧',
  MANUAL: '✍️',
  WEB: '🌐',
};

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const status = params?.status || '';
  const source = params?.source || '';
  const search = params?.search || '';
  const page = params?.page || '1';

  let enquiries: any[] = [];
  let meta = { page: 1, limit: 20, total: 0, totalPages: 0 };

  try {
    const queryParts = [`page=${page}`, `limit=20`];
    if (status) queryParts.push(`status=${status}`);
    if (source) queryParts.push(`source=${source}`);
    if (search) queryParts.push(`search=${search}`);

    const result = await serverFetch(`/enquiry?${queryParts.join('&')}`);
    enquiries = result?.items || [];
    meta = result?.meta || meta;
  } catch (e) {
    console.error("Failed to fetch enquiries", e);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Enquiries</h1>
            <p className="text-muted-foreground mt-1">
              {meta.total} total enquiries
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <form method="get" className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Search</label>
                <input
                  type="text"
                  name="search"
                  defaultValue={search}
                  placeholder="Name, email, phone..."
                  className="flex h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select
                  name="status"
                  defaultValue={status}
                  className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">All Statuses</option>
                  <option value="NEW">New</option>
                  <option value="OPEN">Open</option>
                  <option value="FOLLOW_UP">Follow Up</option>
                  <option value="QUOTATION_SENT">Quotation Sent</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="CLOSED_LOST">Closed (Lost)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <select
                  name="source"
                  defaultValue={source}
                  className="flex h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">All Sources</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                  <option value="MANUAL">Manual</option>
                  <option value="WEB">Web</option>
                </select>
              </div>
              <button type="submit" className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                Filter
              </button>
              {(status || source || search) && (
                <a href="/enquiry" className="h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors flex items-center">
                  Clear
                </a>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enquiries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.name || 'Unknown'}</div>
                      {e.email && <div className="text-sm text-muted-foreground">{e.email}</div>}
                      {e.phone && <div className="text-sm text-muted-foreground">{e.phone}</div>}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span>{SOURCE_ICONS[e.source] || '📋'}</span>
                        {e.source}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[e.status] || 'bg-secondary text-secondary-foreground'}`}>
                        {e.status.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.assignedTo ? (
                        <span>{e.assignedTo.displayName || e.assignedTo.userName}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })}
                    </TableCell>
                  </TableRow>
                ))}
                {enquiries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                      No enquiries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {meta.page} of {meta.totalPages} ({meta.total} results)
            </p>
            <div className="flex gap-2">
              {meta.page > 1 && (
                <a
                  href={`/enquiry?page=${meta.page - 1}${status ? `&status=${status}` : ''}${source ? `&source=${source}` : ''}${search ? `&search=${search}` : ''}`}
                  className="h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors flex items-center"
                >
                  ← Previous
                </a>
              )}
              {meta.page < meta.totalPages && (
                <a
                  href={`/enquiry?page=${meta.page + 1}${status ? `&status=${status}` : ''}${source ? `&source=${source}` : ''}${search ? `&search=${search}` : ''}`}
                  className="h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors flex items-center"
                >
                  Next →
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
