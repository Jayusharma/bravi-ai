'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Avatar } from '@/components/ui/Avatar';
import { getEnquiries, getEnquiryStats, deleteEnquiry, bulkDeleteEnquiries } from '@/services/enquiry/enquiry.service';
import type { EnquiryListItem, EnquiryListResponse, EnquiryStats } from '@/services/enquiry/enquiry.service';
import '@/styles/enquiries.css';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<string, { label: string; cssClass: string; dotColor: string }> = {
  NEW: { label: 'New', cssClass: 'new', dotColor: '#4F8EF7' },
  OPEN: { label: 'Open', cssClass: 'open', dotColor: '#34C77B' },
  IN_PROGRESS: { label: 'In Progress', cssClass: 'in-progress', dotColor: '#F5913E' },
  AWAITING_CUSTOMER: { label: 'Awaiting', cssClass: 'awaiting', dotColor: '#E5B735' },
  QUOTATION_SENT: { label: 'Quotation Sent', cssClass: 'quotation', dotColor: '#4DA8DA' },
  FOLLOW_UP: { label: 'Follow Up', cssClass: 'follow-up', dotColor: '#9B5DE5' },
  STALE: { label: 'Stale', cssClass: 'stale', dotColor: '#9CA3AF' },
  CONVERTED: { label: 'Converted', cssClass: 'converted', dotColor: '#34C77B' },
  CLOSED_LOST: { label: 'Closed Lost', cssClass: 'closed-lost', dotColor: '#EF4444' },
};

const INTENT_LABELS: Record<string, string> = {
  PRODUCT_INQUIRY: 'Product Inquiry',
  PRICING_REQUEST: 'Pricing Request',
  BULK_ORDER: 'Bulk Order',
  SHIPPING_INQUIRY: 'Shipping Inquiry',
  GENERAL_INFO: 'General Info',
  COMPLAINT: 'Complaint',
  APPOINTMENT: 'Appointment',
  DOCUMENT_SUBMIT: 'Document Submit',
  RETURN_REFUND: 'Return / Refund',
  PARTNERSHIP: 'Partnership',
  UNKNOWN: 'New Enquiry',
};

const SOURCE_CONFIG: Record<string, { label: string; cssClass: string; barClass: string }> = {
  WHATSAPP: { label: 'WhatsApp', cssClass: 'whatsapp', barClass: 'whatsapp' },
  EMAIL: { label: 'Email', cssClass: 'email', barClass: 'email' },
  SMS: { label: 'SMS', cssClass: 'sms', barClass: 'sms' },
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

function formatDate(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SVG ICONS
// ═══════════════════════════════════════════════════════════════════

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SourceIcon({ source }: { source: string }) {
  switch (source) {
    case 'WHATSAPP': return <WhatsAppIcon />;
    case 'EMAIL': return <EmailIcon />;
    case 'SMS': return <SmsIcon />;
    default: return <SmsIcon />;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DONUT CHART
// ═══════════════════════════════════════════════════════════════════

function DonutChart({ overview }: { overview: EnquiryStats['overview'] }) {
  const { total, byStatus } = overview;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { key: 'NEW', label: 'New', color: '#4F8EF7', count: byStatus.NEW || 0 },
    { key: 'IN_PROGRESS', label: 'In Progress', color: '#F5913E', count: (byStatus.IN_PROGRESS || 0) + (byStatus.OPEN || 0) },
    { key: 'FOLLOW_UP', label: 'Follow Up', color: '#9B5DE5', count: byStatus.FOLLOW_UP || 0 },
    { key: 'CONVERTED', label: 'Converted', color: '#34C77B', count: byStatus.CONVERTED || 0 },
    { key: 'CLOSED_LOST', label: 'Closed Lost', color: '#EF4444', count: byStatus.CLOSED_LOST || 0 },
  ].filter((s) => s.count > 0);

  let offset = 0;

  return (
    <div className="donut-chart-container">
      <div className="donut-chart">
        <svg viewBox="0 0 120 120">
          {total === 0 ? (
            <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
          ) : (
            segments.map((seg) => {
              const pct = seg.count / total;
              const dash = pct * circumference;
              const gap = circumference - dash;
              const currentOffset = offset;
              offset += dash;
              return (
                <circle
                  key={seg.key}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="14"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={-currentOffset}
                  strokeLinecap="butt"
                />
              );
            })
          )}
        </svg>
        <div className="donut-chart-center">
          <div className="donut-chart-total">{total}</div>
          <div className="donut-chart-label">Total</div>
        </div>
      </div>
      <div className="donut-legend">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0;
          return (
            <div key={seg.key} className="donut-legend-item">
              <span className="donut-legend-dot" style={{ background: seg.color }} />
              <span className="donut-legend-label">{seg.label}</span>
              <span className="donut-legend-value">{seg.count}</span>
              <span className="donut-legend-pct">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE BREAKDOWN
// ═══════════════════════════════════════════════════════════════════

function SourceBreakdown({ sources }: { sources: EnquiryStats['sourceBreakdown'] }) {
  const maxCount = Math.max(...sources.map((s) => s.count), 1);
  return (
    <div className="source-breakdown">
      {sources.map((src) => {
        const cfg = SOURCE_CONFIG[src.source] || { label: src.source, cssClass: '', barClass: '' };
        const barWidth = (src.count / maxCount) * 100;
        return (
          <div key={src.source} className="source-item">
            <div className={`source-icon ${cfg.cssClass}`}>
              <SourceIcon source={src.source} />
            </div>
            <span className="source-label">{cfg.label}</span>
            <div className="source-bar-container">
              <div
                className={`source-bar ${cfg.barClass}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="source-stat">
              {src.count} ({src.percentage}%)
            </span>
          </div>
        );
      })}
      {sources.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}>No data yet</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// KPI CARDS
// ═══════════════════════════════════════════════════════════════════

function KpiCards({
  kpis,
  activeFilter,
  onFilterClick,
}: {
  kpis: EnquiryStats['kpis'];
  activeFilter: string;
  onFilterClick: (status: string) => void;
}) {
  const cards = [
    {
      key: '',
      label: 'All Enquiries',
      value: kpis.all,
      iconClass: 'all',
      subtitle: kpis.newThisWeek > 0 ? `${kpis.newThisWeek} new this week` : undefined,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
    },
    {
      key: 'NEW',
      label: 'New',
      value: kpis.new,
      iconClass: 'new',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
      ),
    },
    {
      key: 'IN_PROGRESS',
      label: 'In Progress',
      value: kpis.inProgress,
      iconClass: 'in-progress',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4" /><path d="m16.2 7.8 2.9-2.9" /><path d="M18 12h4" /><path d="m16.2 16.2 2.9 2.9" />
          <path d="M12 18v4" /><path d="m4.9 19.1 2.9-2.9" /><path d="M2 12h4" /><path d="m4.9 4.9 2.9 2.9" />
        </svg>
      ),
    },
    {
      key: 'FOLLOW_UP',
      label: 'Follow Up',
      value: kpis.followUp,
      iconClass: 'follow-up',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
    {
      key: 'CONVERTED',
      label: 'Converted',
      value: kpis.converted,
      iconClass: 'converted',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      key: 'CLOSED_LOST',
      label: 'Closed Lost',
      value: kpis.closedLost,
      iconClass: 'closed-lost',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </svg>
      ),
    },
  ];

  return (
    <div className="kpi-cards">
      {cards.map((card) => (
        <div
          key={card.key}
          className={`kpi-card${activeFilter === card.key ? ' active' : ''}`}
          onClick={() => onFilterClick(card.key)}
        >
          <div className={`kpi-icon ${card.iconClass}`}>{card.icon}</div>
          <div className="kpi-content">
            <span className="kpi-label">{card.label}</span>
            <span className="kpi-value">{card.value}</span>
            {card.subtitle && (
              <span className="kpi-subtitle">
                <span className="dot" />
                {card.subtitle}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

interface EnquiriesClientProps {
  initialData: EnquiryListResponse;
  initialStats: EnquiryStats;
}

export default function EnquiriesClient({ initialData, initialStats }: EnquiriesClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [data, setData] = useState(initialData);
  const [stats, setStats] = useState(initialStats);
  const [loading, setLoading] = useState(false);

  // Checkbox selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Action dropdown state
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [source, setSource] = useState(searchParams.get('source') || '');
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') || '10', 10));

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);

  // Close actions dropdown on clicking outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveMenuId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.length === data.items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(data.items.map((item) => item.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDeleteSingle = async (id: string) => {
    if (!confirm('Are you sure you want to delete this enquiry?')) return;
    setLoading(true);
    try {
      await deleteEnquiry(id);
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      const [listRes, statsRes] = await Promise.all([
        getEnquiries({ search, status, source, page, limit }),
        getEnquiryStats()
      ]);
      setData(listRes);
      setStats(statsRes);
    } catch (err) {
      alert('Failed to delete enquiry');
    } finally {
      setLoading(false);
      setActiveMenuId(null);
    }
  };

  const handleDeleteBulk = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected enquiries?`)) return;
    setLoading(true);
    try {
      await bulkDeleteEnquiries(selectedIds);
      setSelectedIds([]);
      const [listRes, statsRes] = await Promise.all([
        getEnquiries({ search, status, source, page: 1, limit }),
        getEnquiryStats()
      ]);
      setData(listRes);
      setStats(statsRes);
      setPage(1);
    } catch (err) {
      alert('Failed to delete enquiries');
    } finally {
      setLoading(false);
    }
  };

  // Fetch enquiries with current filters
  const fetchData = useCallback(async (params: {
    search?: string;
    status?: string;
    source?: string;
    page?: number;
    limit?: number;
  }) => {
    setLoading(true);
    try {
      const result = await getEnquiries({
        search: params.search || undefined,
        status: params.status || undefined,
        source: params.source || undefined,
        page: params.page || 1,
        limit: params.limit || 10,
      });
      setData(result);
    } catch {
      // Keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when filters change (skip first render since we have initialData)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchData({ search, status, source, page, limit });
  }, [status, source, page, limit, fetchData]); // search is handled by debounce

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchData({ search: value, status, source, page: 1, limit });
    }, 400);
  };

  // KPI card click sets status filter
  const handleKpiClick = (statusKey: string) => {
    const newStatus = status === statusKey ? '' : statusKey;
    setStatus(newStatus);
    setPage(1);
  };

  // Pagination
  const { meta } = data;
  const totalPages = meta.totalPages;

  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Enquiries</h1>
          <p className="page-description">Track and manage all customer enquiries in one place.</p>
        </div>
        <Link href="/enquiry/new">
          <button
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{ background: 'hsl(240 80% 60%)' }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
            New Enquiry
          </button>
        </Link>
      </div>

      {/* KPI Cards */}
      <KpiCards kpis={stats.kpis} activeFilter={status} onFilterClick={handleKpiClick} />

      {/* Content: Main + Sidebar */}
      <div className="enquiries-page">
        <div className="enquiries-main">
          {/* Filter Bar */}
          <div className="filter-bar">
            <div className="filter-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                id="enquiry-search"
                type="text"
                placeholder="Search by enquiry title, company or contact..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <select
              id="filter-status"
              className="filter-select"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
            <select
              id="filter-source"
              className="filter-select"
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1); }}
            >
              <option value="">All Sources</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </select>
            <button className="filter-more-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              More Filters
            </button>

            {selectedIds.length > 0 && (
              <button
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors ml-auto animate-fade-in"
                onClick={(e) => { e.stopPropagation(); handleDeleteBulk(); }}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>

          {/* Data Table */}
          <div className="enquiry-table-wrapper" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <table className="enquiry-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={data.items.length > 0 && selectedIds.length === data.items.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded cursor-pointer accent-[hsl(240,80%,60%)]"
                    />
                  </th>
                  <th style={{ width: '220px' }}>Enquiry</th>
                  <th>Company / Contact</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th style={{ width: '150px' }}>Last Activity</th>
                  <th>Created On</th>
                  <th style={{ width: '60px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((enq) => {
                  const statusCfg = STATUS_CONFIG[enq.status] || { label: enq.status, cssClass: 'stale', dotColor: '#9CA3AF' };
                  const sourceCfg = SOURCE_CONFIG[enq.source] || { label: enq.source, cssClass: 'manual', barClass: '' };
                  const intentLabel = INTENT_LABELS[enq.intent || ''] || INTENT_LABELS.UNKNOWN;
                  const created = formatDate(enq.createdAt);
                  const contactSub = enq.phone || enq.email || '';

                  return (
                    <tr key={enq.id} onClick={() => router.push(`/enquiry/${enq.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(enq.id)}
                          onChange={() => toggleSelectOne(enq.id)}
                          className="w-4 h-4 rounded cursor-pointer accent-[hsl(240,80%,60%)]"
                        />
                      </td>
                      <td>
                        <div className="cell-enquiry">
                          <span className="cell-enquiry-name">{intentLabel}</span>
                          <span className="cell-enquiry-sub">{contactSub}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-company">
                          <span className="cell-company-name">{enq.company || enq.name}</span>
                          <span className="cell-company-contact">{enq.company ? enq.name : ''}</span>
                        </div>
                      </td>
                      <td>
                        <div className={`cell-source ${sourceCfg.cssClass}`}>
                          <SourceIcon source={enq.source} />
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${statusCfg.cssClass}`}>
                          {statusCfg.label}
                        </span>
                      </td>
                      <td>
                        <div className="cell-activity">
                          {enq.lastMessagePreview && (
                            <span className="cell-activity-preview">
                              <svg className="msg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                              {enq.lastMessageSender}: {enq.lastMessagePreview}
                            </span>
                          )}
                          <span className="cell-activity-time">
                            {timeAgo(enq.lastActivityAt || enq.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-created">
                          <span className="cell-created-date">{created.date}</span>
                          <span className="cell-created-time">{created.time}</span>
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
                        <button
                          className="cell-actions-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === enq.id ? null : enq.id);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                        {activeMenuId === enq.id && (
                          <div
                            className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 border border-border/80 rounded-lg shadow-lg py-1 z-50 text-left"
                            style={{ top: '100%', right: '14px' }}
                          >
                            <button
                              onClick={() => router.push(`/enquiry/${enq.id}`)}
                              className="w-full px-4 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 text-foreground text-left"
                            >
                              Details
                            </button>
                            <button
                              onClick={() => router.push(`/messaging?contactId=${enq.contactId}`)}
                              className="w-full px-4 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 text-foreground text-left"
                            >
                              View Thread
                            </button>
                            <hr className="border-border/60 my-1" />
                            <button
                              onClick={() => handleDeleteSingle(enq.id)}
                              className="w-full px-4 py-2 text-xs hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 hover:text-red-700 text-left font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="enquiry-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <p>No enquiries found</p>
                        <p className="sub">Try adjusting your filters</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 0 && (
              <div className="enquiry-pagination">
                <span className="pagination-info">
                  Showing {(meta.page - 1) * meta.limit + 1} to {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} enquiries
                </span>
                <div className="pagination-controls">
                  <button
                    className="pagination-btn"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  {getPageNumbers().map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${page === p ? ' active' : ''}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    className="pagination-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <div className="pagination-per-page">
                    <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
                      <option value={10}>10 / page</option>
                      <option value={20}>20 / page</option>
                      <option value={50}>50 / page</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="enquiries-sidebar">
          {/* Enquiry Overview — Donut Chart */}
          <div className="sidebar-card">
            <div className="sidebar-card-header">
              <span className="sidebar-card-title">Enquiry Overview</span>
              <span className="sidebar-card-period">
                This Month
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
            <DonutChart overview={stats.overview} />
            <div className={`overview-change ${stats.overview.changeVsLastMonth >= 0 ? 'positive' : 'negative'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {stats.overview.changeVsLastMonth >= 0 ? (
                  <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>
                ) : (
                  <><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></>
                )}
              </svg>
              {Math.abs(stats.overview.changeVsLastMonth)}% vs last month
            </div>
          </div>

          {/* Source Breakdown */}
          <div className="sidebar-card">
            <div className="sidebar-card-header">
              <span className="sidebar-card-title">Source Breakdown</span>
            </div>
            <SourceBreakdown sources={stats.sourceBreakdown} />
          </div>
        </div>
      </div>
    </div>
  );
}
