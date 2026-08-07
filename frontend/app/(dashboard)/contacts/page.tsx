'use client';

import { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getContacts,
  getContactStats,
  deleteContact,
  deleteContactsBulk,
  type ContactListItem,
  type ContactStats,
} from '@/services/contact';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import { ContactDetailPanel } from '@/components/contacts/ContactDetailPanel';
import { DataTable } from '@/components/data-table';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import {
  Search,
  SlidersHorizontal,
  Plus,
  Trash2,
  Eye,
  RefreshCw,
  Users,
  UserPlus,
  MessageSquare,
  UserX,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   Mini SVG Sparkline — pure CSS/SVG, no chart library needed
   ═══════════════════════════════════════════════════════════ */
function MiniSparkline({ color, data }: { color: string; data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   Mini Donut Arc — shows a percentage ring (like the Vuexy card)
   ═══════════════════════════════════════════════════════════ */
function MiniDonut({ percent, color }: { percent: number; color: string }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="26" textAnchor="middle" fill="currentColor" className="text-foreground text-[10px] font-bold">
        {percent}%
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   Stat Card Component
   ═══════════════════════════════════════════════════════════ */
function StatCard({
  title,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  trend,
  trendLabel,
  children,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  trend?: number;
  trendLabel?: string;
  children?: React.ReactNode;
}) {
  const isPositive = (trend ?? 0) >= 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="text-xl font-bold text-foreground tracking-tight">{value}</p>
          </div>
        </div>
        {children}
      </div>

      {trend !== undefined && (
        <div className="flex items-center gap-1.5 text-xs">
          {isPositive ? (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
          )}
          <span className={isPositive ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-500'}>
            {isPositive ? '+' : ''}{trend}%
          </span>
          {trendLabel && <span className="text-muted-foreground">{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Channel Cell — icon + text label
   ═══════════════════════════════════════════════════════════ */
function ChannelCell({ channel }: { channel?: string }) {
  if (channel === 'WHATSAPP') {
    return (
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0 text-emerald-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.458h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        <span className="text-sm text-foreground">WhatsApp</span>
      </div>
    );
  }
  if (channel === 'EMAIL') {
    return (
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0 text-sky-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
        <span className="text-sm text-foreground">Email</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 shrink-0 text-violet-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
      </svg>
      <span className="text-sm text-foreground">SMS</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Status Cell — colored dot + text
   ═══════════════════════════════════════════════════════════ */
function StatusCell({ isActive }: { isActive: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      <span className={isActive ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}>
        {isActive ? 'Active' : 'Inactive'}
      </span>
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main Contacts Page
   ═══════════════════════════════════════════════════════════ */
export default function ContactsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [filterChannel, setFilterChannel] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [showFilters, setShowFilters] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const effectiveStatus = activeTab !== 'ALL' ? activeTab : filterStatus;

  const {
    data: contactsResult,
    isPending: isContactsLoading,
    isError: isContactsError,
    error: contactsError,
    refetch: refetchContacts,
  } = useQuery({
    queryKey: ['contacts', page, limit, search, filterChannel, effectiveStatus],
    queryFn: () =>
      getContacts({
        search: search.trim() || undefined,
        page,
        limit,
        channel: filterChannel !== 'ALL' ? filterChannel : undefined,
        status: effectiveStatus !== 'ALL' ? effectiveStatus : undefined,
      }),
  });

  const { data: stats } = useQuery<ContactStats>({
    queryKey: ['contact-stats'],
    queryFn: getContactStats,
  });

  const contacts = contactsResult?.data || [];
  const total = contactsResult?.pagination.total || 0;
  const totalPages = contactsResult?.pagination.totalPages || 1;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
  };

  const handleRowClick = (contactId: string) => {
    setSelectedContactId(contactId);
    setIsDrawerOpen(true);
  };

  const handleDeleteSingle = async (contactId: string) => {
    try {
      await deleteContact(contactId);
      toast.success('Deleted', 'Contact deleted.');
      refreshAll();
    } catch (err: any) {
      toast.error('Blocked', err.message || 'Active enquiry exists.');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    try {
      await deleteContactsBulk(selectedIds);
      toast.success('Deleted', `${selectedIds.length} contacts removed.`);
      setSelectedIds([]);
      setPage(1);
      refreshAll();
    } catch (err: any) {
      toast.error('Error', err.message || 'Some contacts have active enquiries.');
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  /* Derived card data */
  const engagedPercent = stats && stats.total > 0 ? Math.round((stats.engaged / stats.total) * 100) : 0;

  // Fake sparkline data seeded from real stats (purely visual flourish)
  const sparkData = useMemo(() => {
    const base = stats?.newThisMonth || 5;
    return Array.from({ length: 7 }, (_, i) => Math.max(0, base - 3 + Math.floor(Math.sin(i * 1.1) * (base * 0.4) + Math.random() * 2)));
  }, [stats?.newThisMonth]);

  const columns = useMemo<ColumnDef<ContactListItem>[]>(
    () => [
      {
        accessorKey: 'displayName',
        header: 'Name',
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => handleRowClick(c.id)}
            >
              <Avatar fallback={c.displayName || '?'} size="sm" className="shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                  {c.displayName || 'Unnamed'}
                </span>
                {c.organization && (
                  <span className="text-[11px] text-muted-foreground truncate">{c.organization}</span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: 'phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground font-mono">
            {row.original.channels[0]?.identifier || '—'}
          </span>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        cell: ({ row }) => <ChannelCell channel={row.original.channels[0]?.channel} />,
        size: 130,
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusCell isActive={row.original.hasActiveEnquiry} />,
        size: 110,
      },
      {
        accessorKey: 'lastSeenAt',
        header: 'Last Activity',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDate(row.original.lastSeenAt)}</span>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-6 w-full pb-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage and view all your contacts across channels.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-semibold transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete ({selectedIds.length})
            </button>
          )}
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New Contact
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Contacts"
          value={stats?.total.toLocaleString() ?? '—'}
          icon={Users}
          iconBg="bg-primary/10"
          iconColor="text-primary"
          trend={stats?.newThisMonthTrend}
          trendLabel="vs last month"
        />

        <StatCard
          title="New This Month"
          value={stats?.newThisMonth.toLocaleString() ?? '—'}
          icon={UserPlus}
          iconBg="bg-sky-500/10"
          iconColor="text-sky-500"
        >
          <MiniSparkline color="hsl(199, 89%, 48%)" data={sparkData} />
        </StatCard>

        <StatCard
          title="Engaged"
          value={stats?.engaged.toLocaleString() ?? '—'}
          icon={MessageSquare}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-500"
        >
          <MiniDonut percent={engagedPercent} color="hsl(160, 84%, 39%)" />
        </StatCard>

        <StatCard
          title="Unassigned"
          value={stats?.unassigned.toLocaleString() ?? '—'}
          icon={UserX}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-500"
        >
          {stats && stats.total > 0 && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-semibold text-amber-600">
                {Math.round((stats.unassigned / stats.total) * 100)}%
              </span>
              <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${Math.round((stats.unassigned / stats.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </StatCard>
      </div>

      {/* ── Search + Filters Bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 max-w-sm h-9 rounded-lg border border-border bg-card px-3 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Tab-style filter pills */}
        {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition outline-none cursor-pointer border ${
              activeTab === tab
                ? 'bg-primary/10 text-primary border-primary/20'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {tab === 'ALL' ? 'All' : tab === 'ACTIVE' ? 'Active' : 'Inactive'}
          </button>
        ))}

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition outline-none cursor-pointer border ${
            showFilters ? 'bg-primary/10 text-primary border-primary/20' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          More filters
        </button>
      </div>

      {/* ── Collapsible Filters Panel ── */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channel</label>
            <select
              value={filterChannel}
              onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}
              className="h-8 w-40 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none cursor-pointer"
            >
              <option value="ALL">All Channels</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="h-8 w-40 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none cursor-pointer"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>

          <button
            onClick={() => {
              setFilterChannel('ALL');
              setFilterStatus('ALL');
              setActiveTab('ALL');
              setSearch('');
              setPage(1);
              setShowFilters(false);
            }}
            className="h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition outline-none cursor-pointer flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Reset
          </button>
        </div>
      )}

      {/* ── DataTable ── */}
      <DataTable<ContactListItem>
        columns={columns}
        data={contacts}
        loading={isContactsLoading}
        error={isContactsError ? (contactsError as Error) : null}
        onRetry={refetchContacts}
        pagination={{ pageIndex: page - 1, pageSize: limit }}
        pageCount={totalPages}
        total={total}
        pageSizeOptions={[10, 25, 50, 100]}
        onPaginationChange={({ pageIndex, pageSize }) => {
          setPage(pageIndex + 1);
          setLimit(pageSize);
        }}
        selectable={true}
        onRowSelectionChange={(rows) => setSelectedIds(rows.map((r) => r.id))}
        rowActions={(contact) => [
          {
            label: 'View Profile',
            icon: <Eye className="h-3.5 w-3.5" />,
            onClick: () => handleRowClick(contact.id),
          },
          {
            label: 'Delete',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            variant: 'destructive',
            disabled: contact.hasActiveEnquiry,
            onClick: () => handleDeleteSingle(contact.id),
          },
        ]}
        emptyState={{
          title: 'No contacts found',
          description:
            search || filterChannel !== 'ALL' || effectiveStatus !== 'ALL'
              ? 'Try adjusting your search or filters.'
              : 'Add your first contact to get started.',
        }}
      />

      {/* Modals */}
      <CreateContactModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={refreshAll}
      />

      <ContactDetailPanel
        contactId={selectedContactId}
        initialData={contacts.find((c) => c.id === selectedContactId) ?? null}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdate={refreshAll}
        onDelete={() => { setSelectedContactId(null); setIsDrawerOpen(false); refreshAll(); }}
      />
    </div>
  );
}
