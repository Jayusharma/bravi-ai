'use client';

import { useState, useEffect, useRef } from 'react';
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
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import styles from '@/styles/contacts.module.css';

function renderChannelBadge(channel: string) {
  if (channel === 'WHATSAPP') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.75 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40">
        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.458h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        WhatsApp
      </span>
    );
  }
  if (channel === 'EMAIL') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.75 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/40">
        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
        Email
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.75 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40">
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
      </svg>
      SMS
    </span>
  );
}

export default function ContactsPage() {
  const toast = useToast();
  
  // Data loading states
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Filters & Tabs state
  const [showFilters, setShowFilters] = useState(false);
  const [filterChannel, setFilterChannel] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeDropdownContactId, setActiveDropdownContactId] = useState<string | null>(null);

  // Drawer & Modal control states
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Header metrics — fetched separately from GET /contact/stats, real backend counts only
  const [stats, setStats] = useState<ContactStats | null>(null);

  // Close dropdown action menu if clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest(`.${styles.dropdownWrapper}`)) {
        setActiveDropdownContactId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Guards against a slow, stale request clobbering a newer one's results
  const requestSeqRef = useRef(0);

  // Fetch paginated contact list with applied filters
  const fetchContacts = async (currPage: number, currLimit: number, query: string, ch: string, st: string, tab: string) => {
    const requestId = ++requestSeqRef.current;
    try {
      setLoading(true);
      setLoadError(false);
      // Determine final status filter based on active subnav tab or dropdown filters
      let statusParam = st;
      if (tab !== 'ALL') {
        statusParam = tab;
      }

      const res = await getContacts({
        search: query.trim() || undefined,
        page: currPage,
        limit: currLimit,
        channel: ch !== 'ALL' ? ch : undefined,
        status: statusParam !== 'ALL' ? statusParam : undefined,
      });

      if (requestId !== requestSeqRef.current) return; // a newer request already landed

      setContacts(res.data);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.totalPages);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      console.error('Failed to load contacts:', err);
      setLoadError(true);
      toast.error('Failed to Load Contacts', 'Check your connection and try again.');
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false);
    }
  };

  // Fetch real header metrics — separate from the paginated list, refreshed after mutations
  const fetchStats = async () => {
    try {
      setStats(await getContactStats());
    } catch (err) {
      console.error('Failed to load contact stats:', err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab);
  }, [page, limit, filterChannel, filterStatus, activeTab]);

  // Debounced search logic
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchContacts(1, limit, val, filterChannel, filterStatus, activeTab);
    }, 400);
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const handleRowClick = (contactId: string) => {
    setSelectedContactId(contactId);
    setIsDrawerOpen(true);
  };

  // Handles single contact deletion from the row dropdown
  const handleDeleteContactSingle = async (contactId: string) => {
    try {
      await deleteContact(contactId);
      toast.success('Deleted', 'Contact deleted successfully.');
      fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab);
      fetchStats();
    } catch (err: any) {
      toast.error('Deletion Blocked', err.message || 'Active enquiry exists.');
    }
    setActiveDropdownContactId(null);
  };

  // Handles checkbox selection on the table
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Only select contacts that do NOT have active enquiries
      const selectableIds = contacts.filter(c => !c.hasActiveEnquiry).map(c => c.id);
      setSelectedIds(selectableIds);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (contactId: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, contactId]);
    } else {
      setSelectedIds(prev => prev.filter(id => id !== contactId));
    }
  };

  // Performs bulk deletion of selected contacts
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      setLoading(true);
      await deleteContactsBulk(selectedIds);
      toast.success('Bulk Delete', `Successfully deleted ${selectedIds.length} contacts.`);
      setSelectedIds([]);
      setPage(1);
      fetchContacts(1, limit, search, filterChannel, filterStatus, activeTab);
      fetchStats();
    } catch (err: any) {
      toast.error('Bulk Delete Error', err.message || 'Some contacts have active enquiries.');
    } finally {
      setLoading(false);
    }
  };

  const handleContactUpdated = () => {
    fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab);
    fetchStats();
  };

  const handleContactDeleted = () => {
    setSelectedContactId(null);
    setIsDrawerOpen(false);
    fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab);
    fetchStats();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.container}>
      {/* Header section */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1>Contacts</h1>
          <p>Manage all your contacts in one place.</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button variant="destructive" onClick={handleBulkDelete} className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Selected ({selectedIds.length})
            </Button>
          )}
          <Button onClick={() => setIsCreateModalOpen(true)}>
            + Add Contact
          </Button>
        </div>
      </div>

      {/* Metrics row — real backend counts, no fabricated data */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Contacts</span>
          <span className={styles.metricValue}>{stats ? stats.total : '—'}</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>New This Month</span>
          <span className={styles.metricValue}>{stats ? stats.newThisMonth : '—'}</span>
          {stats && stats.newThisMonthTrend !== 0 && (
            <div className={`${styles.metricTrend} ${stats.newThisMonthTrend > 0 ? styles.trendUp : styles.trendDown}`}>
              <span>{stats.newThisMonthTrend > 0 ? '↑' : '↓'} {Math.abs(stats.newThisMonthTrend)}%</span>
              <span className="text-muted-foreground font-normal">vs last month</span>
            </div>
          )}
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Engaged</span>
          <span className={styles.metricValue}>{stats ? stats.engaged : '—'}</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Unassigned</span>
          <span className={styles.metricValue}>{stats ? stats.unassigned : '—'}</span>
        </div>
      </div>

      {/* Subnav tab section */}
      <div className={styles.tabBar}>
        <div className={styles.tabList}>
          <div
            className={`${styles.tabItem} ${activeTab === 'ALL' ? styles.tabItemActive : ''}`}
            onClick={() => { setActiveTab('ALL'); setPage(1); }}
          >
            All Contacts
          </div>
          <div
            className={`${styles.tabItem} ${activeTab === 'ACTIVE' ? styles.tabItemActive : ''}`}
            onClick={() => { setActiveTab('ACTIVE'); setPage(1); }}
          >
            Active
          </div>
          <div
            className={`${styles.tabItem} ${activeTab === 'INACTIVE' ? styles.tabItemActive : ''}`}
            onClick={() => { setActiveTab('INACTIVE'); setPage(1); }}
          >
            Inactive
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-9 px-4 text-xs font-semibold opacity-50 cursor-not-allowed"
            disabled
            title="Export — coming soon"
          >
            Export
          </Button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.searchWrapper}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" x2="16.65" y1="21" y2="16.65" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className={`h-9 px-4 text-xs font-semibold flex items-center gap-1.5 transition-colors ${showFilters ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </Button>
      </div>

      {/* Filter panel dropdown */}
      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Channel</label>
            <Select value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}>
              <option value="ALL">All Channels</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </Select>
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Enquiry Status</label>
            <Select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Has Active Enquiry</option>
              <option value="INACTIVE">No Active Enquiry</option>
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <Button
              variant="ghost"
              className="text-xs font-semibold text-muted-foreground h-9 px-3 hover:text-foreground"
              onClick={() => {
                setFilterChannel('ALL');
                setFilterStatus('ALL');
                setActiveTab('ALL');
                setSearch('');
                setPage(1);
                setShowFilters(false);
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      )}

      {/* Table grid area */}
      <div className={styles.tableContainer}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={styles.checkboxCell}>
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={
                    contacts.length > 0 && 
                    contacts.filter(c => !c.hasActiveEnquiry).length > 0 &&
                    contacts.filter(c => !c.hasActiveEnquiry).every(c => selectedIds.includes(c.id))
                  }
                  disabled={contacts.filter(c => !c.hasActiveEnquiry).length === 0}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Phone / Email</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-16 text-sm text-muted-foreground">
                  Loading contacts...
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={8} className="py-16">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span className="text-sm font-medium text-foreground">Couldn't load contacts</span>
                    <span className="text-xs text-muted-foreground">Check your connection and try again.</span>
                    <Button
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab)}
                    >
                      Retry
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-16">
                  <div className="flex flex-col items-center gap-1.5 text-center">
                    <span className="text-sm font-medium text-foreground">No contacts found</span>
                    <span className="text-xs text-muted-foreground">
                      {search || filterChannel !== 'ALL' || filterStatus !== 'ALL' || activeTab !== 'ALL'
                        ? 'Try adjusting your search or filters.'
                        : 'Add your first contact to get started.'}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => {
                const isSelected = selectedIds.includes(contact.id);
                return (
                  <TableRow
                    key={contact.id}
                    className={`${styles.rowClickable} ${isSelected ? 'bg-accent/40' : ''}`}
                    onClick={() => handleRowClick(contact.id)}
                  >
                    <TableCell className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={`${styles.checkboxInput} ${contact.hasActiveEnquiry ? 'opacity-40 cursor-not-allowed' : ''}`}
                        checked={isSelected}
                        disabled={contact.hasActiveEnquiry}
                        onChange={(e) => handleSelectRow(contact.id, e.target.checked)}
                        title={contact.hasActiveEnquiry ? "Cannot select contact with active enquiry" : undefined}
                      />
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">
                      <div className="flex items-center gap-3">
                        <Avatar fallback={contact.displayName || 'Unknown'} size="sm" />
                        <span>{contact.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {renderChannelBadge(contact.channels[0]?.channel)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {contact.channels[0]?.identifier || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.organization || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(contact.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={contact.hasActiveEnquiry ? 'success' : 'secondary'}>
                        {contact.hasActiveEnquiry ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className={styles.dropdownWrapper}>
                        <button
                          className={styles.dropdownDotButton}
                          onClick={() => setActiveDropdownContactId(activeDropdownContactId === contact.id ? null : contact.id)}
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>
                        
                        {activeDropdownContactId === contact.id && (
                          <div className={styles.dropdownMenu}>
                            <button className={styles.dropdownItem} onClick={() => handleRowClick(contact.id)}>
                              View Profile
                            </button>
                            <button
                              className={`${styles.dropdownItem} ${styles.dropdownItemDestructive} ${contact.hasActiveEnquiry ? 'opacity-40 cursor-not-allowed' : ''}`}
                              onClick={() => !contact.hasActiveEnquiry && handleDeleteContactSingle(contact.id)}
                              disabled={contact.hasActiveEnquiry}
                              title={contact.hasActiveEnquiry ? 'Active enquiries exist' : 'Delete Contact'}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination & Limits Footer */}
        {total > 0 && (
          <div className="flex justify-between items-center px-6 py-4 border-t border-border bg-card/30">
            <span className="text-xs text-muted-foreground">
              Showing page {page} of {totalPages} ({total} contacts)
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Show:</span>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  className="bg-transparent border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                >
                  <option value={10}>10 / page</option>
                  <option value={20}>20 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
              </div>

              {totalPages > 1 && (
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Previous
                  </Button>
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    const pNum = idx + 1;
                    // Render page links dynamically (limit to 5 links around active page)
                    if (Math.abs(page - pNum) < 3 || pNum === 1 || pNum === totalPages) {
                      return (
                        <Button
                          key={pNum}
                          variant={page === pNum ? 'default' : 'outline'}
                          className={`h-8 w-8 p-0 text-xs ${page === pNum ? 'bg-primary text-primary-foreground' : ''}`}
                          onClick={() => setPage(pNum)}
                          disabled={loading}
                        >
                          {pNum}
                        </Button>
                      );
                    } else if (pNum === 2 || pNum === totalPages - 1) {
                      return <span key={pNum} className="text-xs text-muted-foreground self-end px-1">...</span>;
                    }
                    return null;
                  })}
                  <Button
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Manual Creation Modal */}
      <CreateContactModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => { fetchContacts(page, limit, search, filterChannel, filterStatus, activeTab); fetchStats(); }}
      />

      {/* Sliding detail panel */}
      <ContactDetailPanel
        contactId={selectedContactId}
        initialData={contacts.find((c) => c.id === selectedContactId) ?? null}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdate={handleContactUpdated}
        onDelete={handleContactDeleted}
      />
    </div>
  );
}
