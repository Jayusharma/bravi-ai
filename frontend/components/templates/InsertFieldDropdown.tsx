'use client';

import { useEffect, useRef, useState } from 'react';
import { SYSTEM_FIELDS } from '@/lib/template-fields';
import { suggestVariables, type VariableSuggestion } from '@/services/template';

interface InsertFieldDropdownProps {
    /** Called with the bare label (e.g. "Customer Name"); the form wraps it as [Label]. */
    onInsert: (label: string) => void;
    disabled?: boolean;
}

/**
 * "+ Insert Field" popover:
 *   - SYSTEM section: the fixed auto-fill fields (SYSTEM_FIELDS constant).
 *   - CUSTOM section: live search over previously-used custom variables (/variables/suggest),
 *     plus a "Create <query>" affordance to coin a brand-new custom variable.
 */
export function InsertFieldDropdown({ onInsert, disabled }: InsertFieldDropdownProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<VariableSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Debounced custom-variable search
    useEffect(() => {
        if (!open) return;
        const q = query.trim();
        if (!q) {
            setSuggestions([]);
            return;
        }
        let active = true;
        setLoading(true);
        const timer = setTimeout(async () => {
            const result = await suggestVariables(q);
            if (!active) return;
            setSuggestions(result.success && result.data ? result.data : []);
            setLoading(false);
        }, 250);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [query, open]);

    const insert = (label: string) => {
        onInsert(label);
        setOpen(false);
        setQuery('');
        setSuggestions([]);
    };

    const filteredSystem = query.trim()
        ? SYSTEM_FIELDS.filter((f) => f.label.toLowerCase().includes(query.trim().toLowerCase()))
        : SYSTEM_FIELDS;

    // Don't offer "Create" if the query already matches a system or suggested label
    const queryTrim = query.trim();
    const existsAlready =
        !queryTrim ||
        filteredSystem.some((f) => f.label.toLowerCase() === queryTrim.toLowerCase()) ||
        suggestions.some((s) => s.label.toLowerCase() === queryTrim.toLowerCase());

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                </svg>
                Insert Field
            </button>

            {open ? (
                <div className="absolute left-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl">
                    <div className="border-b border-border/60 p-2">
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search or name a new field…"
                            className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                    </div>

                    <div className="max-h-72 overflow-y-auto p-1.5">
                        {/* SYSTEM */}
                        {filteredSystem.length > 0 ? (
                            <>
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Auto-fill fields
                                </p>
                                {filteredSystem.map((f) => (
                                    <button
                                        key={f.source}
                                        type="button"
                                        onClick={() => insert(f.label)}
                                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                                    >
                                        <span className="text-sm">{f.label}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{f.hint}</span>
                                    </button>
                                ))}
                            </>
                        ) : null}

                        {/* CUSTOM (reuse existing) */}
                        {suggestions.length > 0 ? (
                            <>
                                <p className="mt-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Custom fields
                                </p>
                                {suggestions.map((s) => (
                                    <button
                                        key={s.label}
                                        type="button"
                                        onClick={() => insert(s.label)}
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </>
                        ) : null}

                        {loading ? (
                            <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>
                        ) : null}

                        {/* Create new custom field */}
                        {!existsAlready ? (
                            <button
                                type="button"
                                onClick={() => insert(queryTrim)}
                                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-primary transition-colors hover:bg-accent"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                                Create “{queryTrim}”
                            </button>
                        ) : null}

                        {filteredSystem.length === 0 && suggestions.length === 0 && !loading && existsAlready ? (
                            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No fields found</p>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
