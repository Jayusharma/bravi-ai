'use client';

import { useRef, useState, useTransition, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { handleResult, handleVoidResult } from '@/lib/error';
import { Select } from '@/components/ui/Select';
import {
    deleteTemplate,
    duplicateTemplate,
    listTemplates,
    type Template,
    type TemplateType,
} from '@/services/template';

interface TemplateListProps {
    initialData: Template[];
    initialMeta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

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
    const [allTemplates, setAllTemplates] = useState<Template[]>(initialData);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // Filter states
    const [activeTab, setActiveTab] = useState<TemplateType>('INTERNAL');
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('ALL');
    const [selectedLanguage, setSelectedLanguage] = useState('ALL');
    const [sortBy, setSortBy] = useState<'RECENT' | 'POPULAR' | 'NAME'>('RECENT');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // UI Interactive states
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
    const [showCreateDropdown, setShowCreateDropdown] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const createDropdownRef = useRef<HTMLDivElement | null>(null);

    // Fetch all templates client-side to do rich stats & filters
    useEffect(() => {
        let active = true;
        const fetchAll = async () => {
            setIsLoading(true);
            const res = await listTemplates({
                filter_by_template: 'ALL',
                page: 1,
                limit: 1000,
            });
            if (!active) return;
            if (res.success && res.data) {
                setAllTemplates(res.data.data);
            } else {
                toast.error(res.error ?? 'Failed to load templates');
            }
            setIsLoading(false);
        };

        fetchAll();

        return () => {
            active = false;
        };
    }, [refreshKey, toast]);

    // Handle outside clicks for menus
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuId(null);
            }
            if (createDropdownRef.current && !createDropdownRef.current.contains(e.target as Node)) {
                setShowCreateDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Cmd/Ctrl+K Search shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Filter & Sort Logic
    const filteredTemplates = useMemo(() => {
        return allTemplates
            .filter((t) => t.type === activeTab)
            .filter((t) => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return (
                    t.friendlyName.toLowerCase().includes(q) ||
                    t.name.toLowerCase().includes(q) ||
                    t.body.toLowerCase().includes(q)
                );
            })
            .filter((t) => {
                if (selectedCategory === 'ALL') return true;
                if (activeTab === 'INTERNAL') {
                    return t.internalCategory === selectedCategory;
                } else {
                    return t.category === selectedCategory;
                }
            })
            .filter((t) => {
                if (selectedLanguage === 'ALL') return true;
                return t.language === selectedLanguage;
            });
    }, [allTemplates, activeTab, search, selectedCategory, selectedLanguage]);

    const sortedTemplates = useMemo(() => {
        const list = [...filteredTemplates];
        if (sortBy === 'RECENT') {
            list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        } else if (sortBy === 'POPULAR') {
            list.sort((a, b) => b.usedCount - a.usedCount);
        } else if (sortBy === 'NAME') {
            list.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
        }
        return list;
    }, [filteredTemplates, sortBy]);

    // Pagination
    const totalItems = sortedTemplates.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const paginatedTemplates = useMemo(() => {
        const start = (page - 1) * pageSize;
        return sortedTemplates.slice(start, start + pageSize);
    }, [sortedTemplates, page, pageSize]);

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [activeTab, search, selectedCategory, selectedLanguage, sortBy]);

    // Statistics Calculations
    const stats = useMemo(() => {
        const internalCount = allTemplates.filter((t) => t.type === 'INTERNAL').length;
        const whatsappCount = allTemplates.filter((t) => t.type === 'WHATSAPP').length;
        const approvedCount = allTemplates.filter((t) => t.approvalStatus === 'APPROVED').length;
        const pendingCount = allTemplates.filter((t) => t.approvalStatus === 'PENDING').length;
        const rejectedCount = allTemplates.filter((t) => t.approvalStatus === 'REJECTED').length;

        return {
            total: allTemplates.length,
            internal: internalCount,
            whatsapp: whatsappCount,
            approved: approvedCount,
            pending: pendingCount,
            rejected: rejectedCount,
        };
    }, [allTemplates]);

    const activeCategories = useMemo(() => {
        if (activeTab === 'INTERNAL') {
            return ['Sales', 'Follow-up', 'Information', 'Qualification', 'Support', 'General', 'Others'];
        } else {
            return ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
        }
    }, [activeTab]);

    // Top used templates (Frequently used)
    const frequentlyUsed = useMemo(() => {
        return allTemplates
            .filter((t) => t.type === activeTab)
            .sort((a, b) => b.usedCount - a.usedCount)
            .slice(0, 4);
    }, [allTemplates, activeTab]);

    const handleDuplicate = (id: string) => {
        setOpenMenuId(null);
        setBusyId(id);
        startTransition(async () => {
            const result = await duplicateTemplate(id);
            setBusyId(null);
            if (!handleResult(result, toast, { successMessage: 'Template duplicated.', errorTitle: 'Duplicate failed' })) return;
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

    // Use Template (copies snippet text to clipboard and notifies)
    const handleUseTemplate = (t: Template) => {
        navigator.clipboard.writeText(t.body);
        toast.success(`Copied template "${t.friendlyName}" body to clipboard!`);
    };

    // Category Badge coloring helper
    const getCategoryStyles = (category: string) => {
        const clean = category.toLowerCase();
        if (clean === 'sales' || clean === 'marketing') {
            return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';
        }
        if (clean === 'follow-up' || clean === 'utility') {
            return 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400';
        }
        if (clean === 'qualification' || clean === 'authentication') {
            return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400';
        }
        if (clean === 'support') {
            return 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400';
        }
        if (clean === 'information') {
            return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
        }
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    };

    // Get Icon for specific templates
    const getTemplateIcon = (category: string | null) => {
        const cat = (category || '').toLowerCase();
        if (cat === 'sales') {
            return (
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
            );
        }
        if (cat === 'follow-up') {
            return (
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
            );
        }
        if (cat === 'qualification') {
            return (
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
            );
        }
        return (
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0V12m-3-6.5a1.5 1.5 0 013 0v6.5m0-6.5a1.5 1.5 0 013 0V12m0-5.5a1.5 1.5 0 013 0v1.5M12 12v3m0 3H9m3 0h3" />
                </svg>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Templates
                    </h1>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Create, manage and reuse templates for your team and customer conversations.
                    </p>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                    {/* Inline Search Bar */}
                    <div className="relative w-60 hidden sm:block">
                        <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search templates..."
                            className="w-full h-9 pl-8.5 pr-8 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-white"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-slate-400 px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md select-none pointer-events-none">
                            ⌘K
                        </span>
                    </div>

                    {/* Create Button with Dropdown option */}
                    <div className="relative" ref={createDropdownRef}>
                        <button
                            onClick={() => setShowCreateDropdown(!showCreateDropdown)}
                            className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-all shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-[0.98]"
                        >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            <span>Create Template</span>
                            <svg className="w-3 h-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {showCreateDropdown && (
                            <div className="absolute right-0 mt-1.5 w-44 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl shadow-xl z-30 p-1 animate-slide-in-bottom">
                                <Link
                                    href="/templates/new?type=INTERNAL"
                                    onClick={() => setShowCreateDropdown(false)}
                                    className="flex w-full px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300"
                                >
                                    Internal Reply
                                </Link>
                                <Link
                                    href="/templates/new?type=WHATSAPP"
                                    onClick={() => setShowCreateDropdown(false)}
                                    className="flex w-full px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300"
                                >
                                    WhatsApp Template
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Selection Tabs Card (Compact Sizing) ── */}
            <div className="grid grid-cols-2 gap-4 max-w-xl">
                <button
                    onClick={() => setActiveTab('INTERNAL')}
                    className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all relative overflow-hidden group cursor-pointer ${
                        activeTab === 'INTERNAL'
                            ? 'bg-white dark:bg-slate-900 border-indigo-500/30 dark:border-indigo-500/20 shadow-sm ring-1 ring-indigo-500/10'
                            : 'bg-white/60 hover:bg-white border-slate-100 hover:border-slate-200 dark:bg-slate-900/40 dark:border-slate-850 dark:hover:bg-slate-900/60'
                    }`}
                >
                    <div className="flex items-center gap-2.5 w-full">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform flex items-center justify-center">
                            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Internal Replies</span>
                        <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/40">
                            {stats.internal}
                        </span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 dark:text-white mt-2">Internal Replies</span>
                    <span className="text-[11px] text-slate-400 mt-0.5">For team internal use</span>
                    {activeTab === 'INTERNAL' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                    )}
                </button>

                <button
                    onClick={() => setActiveTab('WHATSAPP')}
                    className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all relative overflow-hidden group cursor-pointer ${
                        activeTab === 'WHATSAPP'
                            ? 'bg-white dark:bg-slate-900 border-emerald-500/30 dark:border-emerald-500/20 shadow-sm ring-1 ring-emerald-500/10'
                            : 'bg-white/60 hover:bg-white border-slate-100 hover:border-slate-200 dark:bg-slate-900/40 dark:border-slate-850 dark:hover:bg-slate-900/60'
                    }`}
                >
                    <div className="flex items-center gap-2.5 w-full">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform flex items-center justify-center">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.456L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.413 9.864-9.83.002-2.623-1.01-5.09-2.855-6.94C16.639 1.986 14.195 1.95 11.5 1.95c-5.437 0-9.862 4.414-9.866 9.831-.001 1.762.48 3.487 1.395 5.024L2.04 21.96l5.228-1.37z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">WhatsApp Templates</span>
                        <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/40">
                            {stats.whatsapp}
                        </span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 dark:text-white mt-2">WhatsApp Templates</span>
                    <span className="text-[11px] text-slate-400 mt-0.5">24-hour window & approved templates</span>
                    {activeTab === 'WHATSAPP' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
                    )}
                </button>
            </div>

            {/* ── Direct On Screen Search and Filters (No outer card container) ── */}
            <div className="space-y-3">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${activeTab === 'INTERNAL' ? 'internal' : 'WhatsApp'} templates...`}
                            className="w-full h-10 pl-9 pr-8 text-xs bg-white dark:bg-slate-900 border border-slate-205 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-white shadow-sm"
                        />
                    </div>

                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`h-10 px-4 flex items-center gap-2 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer shadow-sm ${
                            showFilters
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-650 dark:bg-indigo-950/20'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800'
                        }`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                        <span>Filters</span>
                        {(selectedCategory !== 'ALL' || selectedLanguage !== 'ALL' || sortBy !== 'RECENT') && (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                        )}
                    </button>
                </div>

                {/* Collapsible Filter panel */}
                {showFilters && (
                    <div className="flex flex-wrap items-center gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl shadow-sm animate-slide-in-bottom">
                        <div className="w-44">
                            <Select
                                value={selectedCategory}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedCategory(e.target.value)}
                                className="h-8.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500/10 cursor-pointer py-0 px-2.5"
                            >
                                <option value="ALL">All Categories</option>
                                {activeCategories.map((cat) => (
                                    <option key={cat} value={cat}>
                                        {cat}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <div className="w-44">
                            <Select
                                value={selectedLanguage}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedLanguage(e.target.value)}
                                className="h-8.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500/10 cursor-pointer py-0 px-2.5"
                            >
                                <option value="ALL">All Languages</option>
                                <option value="en">English (en)</option>
                                <option value="es">Spanish (es)</option>
                                <option value="hi">Hindi (hi)</option>
                            </Select>
                        </div>

                        <div className="w-44">
                            <Select
                                value={sortBy}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value as any)}
                                className="h-8.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500/10 cursor-pointer py-0 px-2.5"
                            >
                                <option value="RECENT">Sort: Recently Used</option>
                                <option value="POPULAR">Sort: Most Popular</option>
                                <option value="NAME">Sort: Alphabetical</option>
                            </Select>
                        </div>

                        <button
                            onClick={() => {
                                setSelectedCategory('ALL');
                                setSelectedLanguage('ALL');
                                setSortBy('RECENT');
                            }}
                            className="h-8.5 px-3.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-transparent rounded-lg transition-all cursor-pointer flex items-center gap-1.5 text-slate-500 dark:text-slate-400"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Clear
                        </button>
                    </div>
                )}
            </div>

            {/* ── Frequently Used (Left) & Templates Overview (Right) aligned side-by-side ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                
                {/* Frequently Used (col-span-9) */}
                <div className="col-span-1 lg:col-span-9 flex flex-col justify-between">
                    <div className="flex items-center gap-2 mb-3">
                        <svg className="w-4.5 h-4.5 text-yellow-500 fill-yellow-500" viewBox="0 0 24 24">
                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                        <h2 className="text-sm font-bold text-slate-800 dark:text-white">Frequently used</h2>
                    </div>

                    {frequentlyUsed.length === 0 ? (
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-6 flex-1 flex items-center justify-center text-xs text-slate-400">
                            No frequently used templates found yet.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 flex-1">
                            {frequentlyUsed.map((t) => (
                                <div
                                    key={t.id}
                                    className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between h-[195px] hover:shadow-md transition-all group hover:scale-[1.01]"
                                >
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            {getTemplateIcon(t.internalCategory || t.category)}
                                            
                                            <div className="relative">
                                                <button
                                                    onClick={() => setOpenMenuId(openMenuId === t.id ? null : t.id)}
                                                    className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg transition-all cursor-pointer"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                                        <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                                                    </svg>
                                                </button>
                                                {openMenuId === t.id && (
                                                    <div className="absolute right-0 top-full z-20 mt-1 w-32 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 rounded-xl shadow-xl p-1 animate-slide-in-bottom">
                                                        <Link href={`/templates/${t.id}`} className="block px-3.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg">
                                                            Edit
                                                        </Link>
                                                        <button onClick={() => handleDuplicate(t.id)} className="block w-full text-left px-3.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg">
                                                            Duplicate
                                                        </button>
                                                        <button onClick={() => handleDelete(t)} className="block w-full text-left px-3.5 py-1.5 text-[11px] font-semibold text-rose-605 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg">
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-0.5">
                                            <h3 className="text-xs font-bold text-slate-800 dark:text-white line-clamp-1">{t.friendlyName}</h3>
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-normal line-clamp-3 min-h-[36px] leading-relaxed">
                                                {t.body}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-2 mt-auto">
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${getCategoryStyles(t.internalCategory || t.category || 'general')}`}>
                                                {t.internalCategory || t.category || 'General'}
                                            </span>
                                            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
                                                Used {t.usedCount} times
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 border-t border-slate-50 dark:border-slate-800 pt-2">
                                            <button
                                                onClick={() => setPreviewTemplate(t)}
                                                className="h-7 text-[10px] font-bold border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-1 cursor-pointer text-slate-600 dark:text-slate-300"
                                            >
                                                Preview
                                            </button>
                                            <button
                                                onClick={() => handleUseTemplate(t)}
                                                className="h-7 text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer text-indigo-650 dark:text-indigo-400"
                                            >
                                                Use
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Templates Overview Card (col-span-3 - Height Aligned to Left) */}
                <div className="col-span-1 lg:col-span-3 flex flex-col">
                    <div className="bg-white dark:bg-slate-900 border border-slate-105 dark:border-slate-800 rounded-2xl p-4.5 shadow-sm flex-1 flex flex-col justify-between">
                        <div>
                            <h2 className="text-xs font-bold text-slate-800 dark:text-slate-200">Templates Overview</h2>
                            
                            {/* Big total count row */}
                            <div className="mt-3 bg-slate-50 dark:bg-slate-950 rounded-xl p-3 flex items-center justify-between border border-slate-100/50 dark:border-slate-850">
                                <div>
                                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total Templates</p>
                                    <p className="text-xl font-extrabold text-slate-800 dark:text-white mt-0.5">{stats.total}</p>
                                </div>
                                <div className="w-8.5 h-8.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                        <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" />
                                    </svg>
                                </div>
                            </div>

                            {/* Sub stats row */}
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                    <p className="text-[8px] font-bold text-slate-450 uppercase tracking-wide">Internal</p>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-0.5">{stats.internal}</p>
                                </div>
                                <div className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                    <p className="text-[8px] font-bold text-slate-450 uppercase tracking-wide">WhatsApp</p>
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-0.5">{stats.whatsapp}</p>
                                </div>
                            </div>

                            {/* Status rows */}
                            <div className="mt-3 space-y-1.5 border-t border-slate-50 dark:border-slate-800 pt-2.5">
                                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        Approved
                                    </span>
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{stats.approved}</span>
                                </div>

                                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        Pending Approval
                                    </span>
                                    <span className="font-bold text-amber-600 dark:text-amber-400">{stats.pending}</span>
                                </div>

                                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                        Rejected
                                    </span>
                                    <span className="font-bold text-rose-600 dark:text-rose-400">{stats.rejected}</span>
                                </div>
                            </div>
                        </div>

                        {/* View Approval Queue button */}
                        <button
                            onClick={() => {
                                setSelectedCategory('ALL');
                                setSelectedLanguage('ALL');
                                setSearch('');
                                if (activeTab !== 'WHATSAPP') setActiveTab('WHATSAPP');
                                setSortBy('RECENT');
                                toast.success('Filtered templates for WhatsApp Review queue.');
                            }}
                            className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-2.5"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            View Approval Queue
                        </button>
                    </div>
                </div>
            </div>

            {/* ── All Templates Listing Table (Full Page Width) ── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-105 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm w-full">
                <div className="p-4 border-b border-slate-50 dark:border-slate-800">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white font-semibold">
                        All {activeTab === 'INTERNAL' ? 'internal' : 'WhatsApp'} templates
                    </h2>
                </div>

                {isLoading ? (
                    <div className="flex h-64 items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                            <svg className="h-6 w-6 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <span className="text-xs text-slate-400">Loading templates...</span>
                        </div>
                    </div>
                ) : paginatedTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                                <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" />
                            </svg>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">No templates found</p>
                        <p className="mt-1 text-[11px] text-slate-450">Try matching your filters or creating a new template.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-50 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-slate-50/50 dark:bg-slate-900/30">
                                    <th className="py-3.5 px-6 min-w-[280px]">Template</th>
                                    <th className="py-3.5 px-4">Category</th>
                                    <th className="py-3.5 px-4">Language</th>
                                    <th className="py-3.5 px-4 text-center">Used</th>
                                    <th className="py-3.5 px-4">Updated</th>
                                    <th className="py-3.5 px-6 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/80">
                                {paginatedTemplates.map((t) => (
                                    <tr key={t.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/20 group transition-all">
                                        {/* Template Column */}
                                        <td className="py-3 px-6">
                                            <div className="flex items-center gap-3">
                                                {getTemplateIcon(t.internalCategory || t.category)}
                                                <div className="min-w-0">
                                                    <Link href={`/templates/${t.id}`} className="hover:underline font-bold text-xs text-slate-800 dark:text-slate-200 block truncate">
                                                        {t.friendlyName}
                                                    </Link>
                                                    <span className="text-[11px] text-slate-400 dark:text-slate-500 line-clamp-1 mt-0.5 font-normal">
                                                        {t.body}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Category Column */}
                                        <td className="py-3 px-4 whitespace-nowrap">
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${getCategoryStyles(t.internalCategory || t.category || 'general')}`}>
                                                {t.internalCategory || t.category || 'General'}
                                            </span>
                                        </td>

                                        {/* Language Column */}
                                        <td className="py-3 px-4 font-semibold text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            {t.language === 'en' ? 'English' : t.language === 'es' ? 'Spanish' : t.language === 'hi' ? 'Hindi' : t.language}
                                        </td>

                                        {/* Used Column */}
                                        <td className="py-3 px-4 text-center font-bold text-xs text-slate-850 dark:text-slate-200 tabular-nums whitespace-nowrap">
                                            {t.usedCount}
                                        </td>

                                        {/* Updated Column */}
                                        <td className="py-3 px-4 font-semibold text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                                            {formatDate(t.updatedAt)}
                                        </td>

                                        {/* Actions Column */}
                                        <td className="py-3 px-6 text-right whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-2">
                                                {/* Preview shortcut icon */}
                                                <button
                                                    onClick={() => setPreviewTemplate(t)}
                                                    className="p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg transition-all cursor-pointer"
                                                    title="Preview template"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </button>

                                                {/* Options Dropdown */}
                                                <div className="relative">
                                                    <button
                                                        onClick={() => setOpenMenuId(openMenuId === t.id ? null : t.id)}
                                                        className="p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg transition-all cursor-pointer"
                                                    >
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                                                        </svg>
                                                    </button>
                                                    {openMenuId === t.id && (
                                                        <div className="absolute right-0 top-full z-20 mt-1 w-32 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 rounded-xl shadow-xl p-1 animate-slide-in-bottom">
                                                            <Link href={`/templates/${t.id}`} className="block px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-left">
                                                                Edit
                                                            </Link>
                                                            <button onClick={() => handleDuplicate(t.id)} className="block w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg">
                                                                Duplicate
                                                            </button>
                                                            <button onClick={() => handleDelete(t)} className="block w-full text-left px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg">
                                                                Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Footer */}
                {!isLoading && totalPages > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-50 dark:border-slate-800 p-4">
                        <div className="text-[11px] font-semibold text-slate-400">
                            Showing <span className="text-slate-700 dark:text-slate-200">{(page - 1) * pageSize + 1}</span> to{' '}
                            <span className="text-slate-700 dark:text-slate-200">{Math.min(totalItems, page * pageSize)}</span> of{' '}
                            <span className="text-slate-700 dark:text-slate-200">{totalItems}</span> templates
                        </div>

                        <div className="flex items-center gap-1.5">
                            {/* Prev Button */}
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 disabled:opacity-40 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer active:scale-95"
                            >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m15 18-6-6 6-6" />
                                </svg>
                            </button>

                            {/* Page numbers */}
                            <div className="flex items-center gap-1">
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                                    const isSelected = page === p;
                                    return (
                                        <button
                                            key={p}
                                            onClick={() => setPage(p)}
                                            className={`h-7 w-7 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'bg-indigo-650 text-white shadow-sm'
                                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
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
                                className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 disabled:opacity-40 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer active:scale-95"
                            >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </button>

                            {/* Page size select */}
                            <Select
                                value={String(pageSize)}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPageSize(Number(e.target.value))}
                                className="h-7 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer py-0 px-2.5"
                            >
                                <option value="10">10 / page</option>
                                <option value="20">20 / page</option>
                                <option value="50">50 / page</option>
                            </Select>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Premium Preview Modal ── */}
            {previewTemplate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 dark:bg-slate-950/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-2xl max-w-lg w-full overflow-hidden animate-slide-in-bottom">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/20 dark:bg-slate-900/20">
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{previewTemplate.friendlyName}</h3>
                                <p className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 font-mono mt-0.5">{previewTemplate.name}</p>
                            </div>
                            <button
                                onClick={() => setPreviewTemplate(null)}
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-205 rounded-xl transition-all cursor-pointer"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {/* Modal Body */}
                        <div className="p-5 space-y-4">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-150 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                                    {previewTemplate.type}
                                </span>
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 dark:text-indigo-400 uppercase tracking-wide">
                                    {previewTemplate.channel}
                                </span>
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                    {previewTemplate.language === 'en' ? 'English (en)' : previewTemplate.language}
                                </span>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-auto ${getCategoryStyles(previewTemplate.internalCategory || previewTemplate.category || 'general')}`}>
                                    {previewTemplate.internalCategory || previewTemplate.category || 'General'}
                                </span>
                            </div>

                            {/* Phone chat style preview */}
                            <div className="rounded-2xl bg-[#e7ddd1] dark:bg-slate-950 p-4 border border-slate-200/40 dark:border-slate-850">
                                <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-white dark:bg-slate-900 px-3 py-2.5 text-[11px] leading-relaxed text-slate-800 dark:text-slate-100 shadow-sm border border-slate-100/50 dark:border-slate-855">
                                    {renderHighlightedBody(previewTemplate.body)}
                                </div>
                            </div>
                        </div>
                        {/* Modal Footer */}
                        <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(previewTemplate.body);
                                    toast.success('Template body copied to clipboard!');
                                }}
                                className="h-8.5 px-3.5 text-xs font-bold text-slate-650 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-all cursor-pointer"
                            >
                                Copy Snippet
                            </button>
                            <Link href={`/templates/${previewTemplate.id}`}>
                                <button className="h-8.5 px-3.5 text-xs font-bold text-white bg-indigo-650 hover:bg-indigo-700 rounded-xl transition-all shadow-sm cursor-pointer">
                                    Edit Template
                                </button>
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
