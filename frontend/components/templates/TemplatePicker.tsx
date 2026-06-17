'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getUsableTemplates, type UsableTemplate } from '@/services/template';
import { tokenizeBody, renderBody } from '@/lib/template-parse';

interface TemplatePickerProps {
    enquiryId: string;
    channel: 'WHATSAPP' | 'EMAIL';
    onInsert: (text: string) => void;
    onClose: () => void;
}

/**
 * Composer template picker:
 *   list usable INTERNAL templates → select → fill panel (SYSTEM pre-resolved/editable,
 *   CUSTOM blank) → live preview → Insert resolved text into the composer.
 */
export function TemplatePicker({ enquiryId, channel, onInsert, onClose }: TemplatePickerProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [templates, setTemplates] = useState<UsableTemplate[]>([]);
    const [selected, setSelected] = useState<UsableTemplate | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            const result = await getUsableTemplates(enquiryId, channel);
            if (!active) return;
            if (result.success && result.data) {
                setTemplates(result.data);
                setError(null);
            } else {
                setError(result.error ?? 'Failed to load templates');
            }
            setLoading(false);
        })();
        return () => { active = false; };
    }, [enquiryId, channel]);

    const choose = (t: UsableTemplate) => {
        const initial: Record<string, string> = {};
        for (const v of t.resolvedVariables) initial[v.label] = v.value ?? '';
        setValues(initial);
        setSelected(t);
    };

    const previewTokens = useMemo(
        () => (selected ? tokenizeBody(selected.body, values) : []),
        [selected, values],
    );

    const unfilled = selected
        ? selected.resolvedVariables.filter((v) => !values[v.label]?.trim())
        : [];

    const handleInsert = () => {
        if (!selected || unfilled.length > 0) return;
        onInsert(renderBody(selected.body, values));
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                        {selected ? (
                            <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                            </button>
                        ) : null}
                        <h3 className="text-base font-semibold">{selected ? selected.friendlyName : 'Insert a template'}</h3>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5">
                    {loading ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">Loading templates…</p>
                    ) : error ? (
                        <p className="py-10 text-center text-sm text-destructive">{error}</p>
                    ) : !selected ? (
                        // ── List ──
                        templates.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">
                                No {channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} templates yet. Create one under Templates.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {templates.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => choose(t)}
                                        className="flex w-full flex-col rounded-xl border border-border/70 bg-background p-3 text-left transition-colors hover:border-border hover:bg-accent/50"
                                    >
                                        <span className="text-sm font-medium">{t.friendlyName}</span>
                                        <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.body}</span>
                                        {t.resolvedVariables.length > 0 ? (
                                            <span className="mt-2 text-[11px] text-muted-foreground">
                                                {t.resolvedVariables.length} variable{t.resolvedVariables.length > 1 ? 's' : ''}
                                            </span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        )
                    ) : (
                        // ── Fill panel ──
                        <div className="space-y-5">
                            {selected.resolvedVariables.length > 0 ? (
                                <div className="space-y-3">
                                    {selected.resolvedVariables.map((v) => (
                                        <div key={v.label}>
                                            <div className="mb-1 flex items-center gap-2">
                                                <label className="text-sm font-medium">{v.label}</label>
                                                <Badge variant={v.type === 'SYSTEM' ? 'success' : 'secondary'}>
                                                    {v.type === 'SYSTEM' ? 'auto-filled' : 'fill in'}
                                                </Badge>
                                            </div>
                                            <input
                                                value={values[v.label] ?? ''}
                                                onChange={(e) => setValues((s) => ({ ...s, [v.label]: e.target.value }))}
                                                placeholder={v.type === 'SYSTEM' ? 'No value on file — type one' : `Enter ${v.label}`}
                                                className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {/* Preview */}
                            <div>
                                <span className="mb-2 block text-sm font-medium">Preview</span>
                                <div className="rounded-2xl bg-[#e7ddd1] p-4 dark:bg-[#0b141a]">
                                    <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm leading-relaxed text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-white">
                                        {previewTokens.map((tok, i) =>
                                            tok.type === 'text' ? (
                                                <span key={i}>{tok.value}</span>
                                            ) : tok.value ? (
                                                <span key={i} className="font-medium">{tok.value}</span>
                                            ) : (
                                                <span key={i} className="rounded bg-black/10 px-1 text-[0.85em] font-medium dark:bg-white/15">{tok.label}</span>
                                            ),
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer (fill panel only) */}
                {selected ? (
                    <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3.5">
                        <span className="text-xs text-muted-foreground">
                            {unfilled.length > 0 ? `${unfilled.length} variable${unfilled.length > 1 ? 's' : ''} still empty` : 'All variables filled'}
                        </span>
                        <Button onClick={handleInsert} disabled={unfilled.length > 0}>Insert into message</Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
