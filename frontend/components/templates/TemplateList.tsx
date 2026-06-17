'use client';

import { useRef, useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { handleResult, handleVoidResult } from '@/lib/error';
import {
    deleteTemplate,
    duplicateTemplate,
    listTemplates,
    type Template,
    type TemplateType,
    type TemplateChannel,
} from '@/services/template';
import { TemplateStatusBadge } from './TemplateStatusBadge';

interface TemplateListProps {
    initialData: Template[];
    initialMeta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

type TypeFilter = 'ALL' | TemplateType;
type ChannelFilter = 'ALL' | TemplateChannel;

function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const day = 86_400_000;
    if (diff < day && d.getDate() === new Date().getDate()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 7 * day) {
        return `${Math.max(1, Math.floor(diff / day))}d ago`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderHighlightedBody(body: string) {
    if (!body) return '';
    const parts = body.split(/(\[[^\]]+\])/g);
    return parts.map((part, index) => {
        if (part.startsWith('[') && part.endsWith(']')) {
            return (
                <span
                    key={index}
                    className="text-indigo-600 dark:text-indigo-400 font-semibold mx-0.5"
                >
                    {part}
                </span>
            );
        }
        return <span key={index}>{part}</span>;
    });
}

export function TemplateList({ initialData, initialMeta }: TemplateListProps) {
    const toast = useToast();
    const [isPending, startTransition] = useTransition();

    // Template state
    const [templates, setTemplates] = useState<Template[]>(initialData);
    const [total, setTotal] = useState(initialMeta.total);
    const [totalPages, setTotalPages] = useState(initialMeta.totalPages);

    // Filters and pagination state
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
    const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(initialMeta.page);
    const [limit, setLimit] = useState(initialMeta.limit);

    // UI state
    const [showFilters, setShowFilters] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1); // Reset to first page on search
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Handle menu close outside click
    useEffect(() => {
        if (!openMenuId) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [openMenuId]);

    // Client-side fetch
    useEffect(() => {
        let active = true;
        const fetchTemplates = async () => {
            setIsLoading(true);
            const res = await listTemplates({
                filter_by_template: typeFilter,
                filter_by_channel: channelFilter,
                search: debouncedSearch,
                page,
                limit,
            });
            if (!active) return;
            if (res.success && res.data) {
                setTemplates(res.data.data);
                setTotal(res.data.meta.total);
                setTotalPages(res.data.meta.totalPages);
            } else {
                toast.error(res.error ?? 'Failed to load templates');
            }
            setIsLoading(false);
        };

        fetchTemplates();

        return () => {
            active = false;
        };
    }, [typeFilter, channelFilter, debouncedSearch, page, limit, refreshKey, toast]);

    const handleTypeFilterChange = (t: TypeFilter) => {
        setTypeFilter(t);
        setPage(1);
    };

    const handleChannelFilterChange = (c: ChannelFilter) => {
        setChannelFilter(c);
        setPage(1);
    };

    const handleLimitChange = (l: number) => {
        setLimit(l);
        setPage(1);
    };

    const handleDuplicate = (id: string) => {
        setOpenMenuId(null);
        setBusyId(id);
        startTransition(async () => {
            const result = await duplicateTemplate(id);
            setBusyId(null);
            if (!handleResult(result, toast, { successMessage: 'Template duplicated as a new draft.', errorTitle: 'Duplicate failed' })) return;
            setRefreshKey((k) => k + 1);
        });
    };

    const handleDelete = (t: Template) => {
        setOpenMenuId(null);
        if (!window.confirm(`Delete template "${t.friendlyName}"? This cannot be undone.`)) return;
        setBusyId(t.id);
        startTransition(async () => {
            const result = await deleteTemplate(t.id);
            setBusyId(null);
            if (!handleVoidResult(result, toast, { successMessage: 'Template deleted.', errorTitle: 'Delete failed' })) return;
            setRefreshKey((k) => k + 1);
        });
    };

    const activeFilterCount =
        (typeFilter !== 'ALL' ? 1 : 0) +
        (channelFilter !== 'ALL' ? 1 : 0) +
        (limit !== 50 ? 1 : 0);

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-foreground/75 bg-clip-text text-transparent">
                        Message Templates
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Reusable replies and Meta-approved WhatsApp templates with variable substitution.
                    </p>
                </div>
                <Link href="/templates/new">
                    <Button className="h-11 px-5 rounded-2xl bg-gradient-to-r from-neutral-900 to-neutral-800 dark:from-neutral-100 dark:to-neutral-200 hover:from-neutral-800 hover:to-neutral-700 dark:hover:from-neutral-200 dark:hover:to-neutral-300 shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center gap-2">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        <span className="font-semibold">New Template</span>
                    </Button>
                </Link>
            </div>

            {/* ── Stats Summary ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-border/30 bg-card/45 p-4.5 backdrop-blur-md flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all">
                    <div className="p-3 bg-neutral-900/5 dark:bg-white/5 rounded-xl text-muted-foreground shrink-0">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate">Total Templates</p>
                        <p className="text-xl font-bold mt-0.5 tracking-tight">{total}</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card/45 p-4.5 backdrop-blur-md flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all">
                    <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400 shrink-0">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate">WhatsApp</p>
                        <p className="text-xl font-bold mt-0.5 tracking-tight">
                            {templates.filter(t => t.channel === 'WHATSAPP').length}
                        </p>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card/45 p-4.5 backdrop-blur-md flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all">
                    <div className="p-3 bg-sky-500/10 rounded-xl text-sky-600 dark:text-sky-400 shrink-0">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate">Email Channel</p>
                        <p className="text-xl font-bold mt-0.5 tracking-tight">
                            {templates.filter(t => t.channel === 'EMAIL').length}
                        </p>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card/45 p-4.5 backdrop-blur-md flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all">
                    <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400 shrink-0">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate">Dynamic Vars</p>
                        <p className="text-xl font-bold mt-0.5 tracking-tight">
                            {templates.filter(t => t.variables.length > 0).length}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Search and Filter Toggle Bar ── */}
            <div className="flex items-center gap-3">
                {/* Search input (larger, left-aligned) */}
                <div className="relative flex-1 max-w-lg">
                    <svg className="pointer-events-none absolute left-4.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search templates by name or slug…"
                        className="h-11 pl-11 text-sm bg-card/65 border border-border/30 rounded-2xl shadow-sm focus:ring-2 focus:ring-primary/10 transition-all focus:bg-card"
                    />
                </div>

                {/* Filter Icon Button (right-aligned) */}
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`h-11 px-4 flex items-center gap-2 rounded-2xl border transition-all active:scale-95 cursor-pointer font-medium text-sm ${
                        showFilters
                            ? 'border-primary bg-primary text-primary-foreground shadow-md'
                            : 'border-border/30 bg-card/60 text-foreground hover:bg-accent/40 shadow-sm'
                    }`}
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    <span>Filters</span>
                    {activeFilterCount > 0 && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${showFilters ? 'bg-primary-foreground text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                            {activeFilterCount}
                        </span>
                    )}
                </button>
            </div>

            {/* ── Collapsible Filter Panel ── */}
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-6 rounded-3xl bg-card/30 backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden ${
                showFilters
                    ? 'max-h-60 opacity-100 p-5 border border-border/30 mt-4 shadow-sm'
                    : 'max-h-0 opacity-0 p-0 border-transparent mt-0 pointer-events-none'
            }`}>
                {/* Filter by Type */}
                <div className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block px-1">Template Type</span>
                    <div className="inline-flex rounded-xl border border-border/30 bg-accent/40 p-1 w-full">
                        {(['ALL', 'INTERNAL', 'WHATSAPP'] as TypeFilter[]).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => handleTypeFilterChange(t)}
                                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                                    typeFilter === t
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {t === 'ALL' ? 'All' : t === 'INTERNAL' ? 'Internal' : 'WhatsApp'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Filter by Channel */}
                <div className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block px-1">Channel</span>
                    <div className="relative">
                        <Select
                            value={channelFilter}
                            onChange={(e) => handleChannelFilterChange(e.target.value as ChannelFilter)}
                            className="h-10 w-full bg-background/50 border border-border/30 rounded-xl focus:ring-2 focus:ring-primary/10 text-xs px-3 font-semibold cursor-pointer"
                        >
                            <option value="ALL">All channels</option>
                            <option value="WHATSAPP">WhatsApp</option>
                            <option value="EMAIL">Email</option>
                        </Select>
                    </div>
                </div>

                {/* Filter by Limit */}
                <div className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block px-1">Items Per Page</span>
                    <div className="relative">
                        <Select
                            value={String(limit)}
                            onChange={(e) => handleLimitChange(Number(e.target.value))}
                            className="h-10 w-full bg-background/50 border border-border/30 rounded-xl focus:ring-2 focus:ring-primary/10 text-xs px-3 font-semibold cursor-pointer"
                        >
                            <option value="10">10 templates</option>
                            <option value="50">50 templates</option>
                            <option value="100">100 templates</option>
                        </Select>
                    </div>
                </div>
            </div>

            {/* ── Grid / empty state / loading ── */}
            {isLoading ? (
                <div className="flex h-64 items-center justify-center rounded-2xl border border-border/70 bg-card/20">
                    <div className="flex flex-col items-center gap-2">
                        <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-muted-foreground">Loading templates...</span>
                    </div>
                </div>
            ) : templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 py-20 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" />
                        </svg>
                    </div>
                    <p className="text-sm font-medium">No templates match your filters</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try clearing or changing the filters above.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {templates.map((t) => {
                        const isInternal = t.type === 'INTERNAL';
                        const status = t.approvalStatus ?? 'DRAFT';
                        return (
                            <div
                                key={t.id}
                                className={`group relative flex flex-col rounded-3xl border border-border/30 bg-gradient-to-br from-card/85 via-card/75 to-card/65 p-5.5 backdrop-blur-md transition-all duration-300 hover:border-primary/20 hover:from-card/95 hover:via-card/90 hover:to-card/85 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 ${busyId === t.id ? 'opacity-60' : ''}`}
                            >
                                {/* Top row: status + kebab */}
                                <div className="mb-3.5 flex items-center justify-between gap-2">
                                    {isInternal ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                            Internal
                                        </span>
                                    ) : status === 'APPROVED' ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                            Approved
                                        </span>
                                    ) : status === 'PENDING' ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            Pending
                                        </span>
                                    ) : status === 'REJECTED' ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 border border-rose-500/20" title={t.rejectionReason || undefined}>
                                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                            Rejected
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 border border-slate-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                            Draft
                                        </span>
                                    )}

                                    {/* Template Options Dropdown */}
                                    <div className="relative" ref={openMenuId === t.id ? menuRef : null}>
                                        <button
                                            onClick={() => setOpenMenuId((c) => (c === t.id ? null : t.id))}
                                            className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100 cursor-pointer"
                                            aria-label="Template actions"
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                                            </svg>
                                        </button>
                                        {openMenuId === t.id ? (
                                            <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border/80 bg-popover p-1 shadow-xl">
                                                <Link href={`/templates/${t.id}`} onClick={() => setOpenMenuId(null)} className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent font-medium">
                                                    Edit
                                                </Link>
                                                <button onClick={() => handleDuplicate(t.id)} disabled={isPending} className="block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent font-medium cursor-pointer">
                                                    Duplicate
                                                </button>
                                                <button onClick={() => handleDelete(t)} disabled={isPending} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 font-medium cursor-pointer">
                                                    Delete
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                {/* Title */}
                                <Link href={`/templates/${t.id}`} className="min-w-0 group/title block">
                                    <h3 className="truncate text-base font-bold tracking-tight text-foreground transition-colors group-hover/title:text-primary">
                                        {t.friendlyName}
                                    </h3>
                                    <span className="inline-flex mt-1 text-[10px] font-mono bg-accent/40 text-muted-foreground px-2 py-0.5 rounded-md border border-border/20 tracking-wide">
                                        {t.name}
                                    </span>
                                </Link>

                                {/* Body preview */}
                                <div className="mt-3.5 flex-1 rounded-2xl bg-accent/20 border border-border/20 p-3.5 text-xs text-muted-foreground/90 font-normal line-clamp-3 leading-relaxed relative overflow-hidden group-hover:bg-accent/30 transition-colors min-h-[64px]">
                                    {renderHighlightedBody(t.body)}
                                </div>

                                {/* Footer meta */}
                                <div className="mt-4.5 flex items-center gap-2 border-t border-border/20 pt-3.5 text-[11px] text-muted-foreground">
                                    {t.channel === 'WHATSAPP' ? (
                                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/15">
                                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                            </svg>
                                            WhatsApp
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400 border border-sky-500/15">
                                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                            </svg>
                                            Email
                                        </span>
                                    )}

                                    {t.variables.length > 0 ? (
                                        <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 border border-indigo-500/15">
                                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
                                            </svg>
                                            {t.variables.length} {t.variables.length === 1 ? 'var' : 'vars'}
                                        </span>
                                    ) : null}
                                    <span className="ml-auto font-medium text-muted-foreground/60" suppressHydrationWarning>{formatDate(t.updatedAt)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Pagination Controls ── */}
            {!isLoading && totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/20 pt-5 mt-8">
                    <div className="text-xs text-muted-foreground font-medium">
                        Showing <span className="font-semibold text-foreground">{Math.min(total, (page - 1) * limit + 1)}</span> to{' '}
                        <span className="font-semibold text-foreground">{Math.min(total, page * limit)}</span> of{' '}
                        <span className="font-semibold text-foreground">{total}</span> templates
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* Prev Button */}
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-semibold border border-border/30 bg-card hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-40 h-9 px-3.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                        >
                            <svg className="h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m15 18-6-6 6-6" />
                            </svg>
                            Previous
                        </button>

                        {/* Page Numbers */}
                        <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                                const isNear = Math.abs(p - page) <= 1;
                                const isEdge = p === 1 || p === totalPages;
                                if (!isNear && !isEdge) {
                                    if (p === 2 || p === totalPages - 1) {
                                        return <span key={p} className="px-1 text-xs text-muted-foreground/60 font-semibold select-none">...</span>;
                                    }
                                    return null;
                                }
                                const isSelected = page === p;
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setPage(p)}
                                        className={`inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-semibold h-9 w-9 cursor-pointer transition-all active:scale-95 ${
                                            isSelected
                                                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/10'
                                                : 'border border-transparent bg-transparent hover:bg-accent/40 text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {p}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Next Button */}
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-semibold border border-border/30 bg-card hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-40 h-9 px-3.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                        >
                            Next
                            <svg className="h-4 w-4 ml-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m9 18 6-6-6-6" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
