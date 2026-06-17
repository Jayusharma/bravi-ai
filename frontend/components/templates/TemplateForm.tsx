'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { handleResult } from '@/lib/error';
import {
    createTemplate,
    updateTemplate,
    type Template,
    type TemplateType,
    type TemplateChannel,
    type WaContentType,
    type WaTemplateCategory,
    type CreateTemplateInput,
} from '@/services/template';
import {
    parseTemplateVariables,
    tokenizeBody,
    isSystemLabel,
    slugifyName,
} from '@/lib/template-parse';
import { InsertFieldDropdown } from './InsertFieldDropdown';
import { TemplateStatusBadge } from './TemplateStatusBadge';

interface TemplateFormProps {
    /** Existing template when editing; undefined when creating. */
    template?: Template;
}

const LABEL = 'mb-1.5 block text-sm font-medium';
const HINT = 'mt-1 text-xs text-muted-foreground';

export function TemplateForm({ template }: TemplateFormProps) {
    const router = useRouter();
    const toast = useToast();
    const [isPending, startTransition] = useTransition();
    const isEdit = !!template;

    // ── Frozen? WHATSAPP templates past DRAFT cannot be edited (Meta rule) ──
    const frozen =
        template?.type === 'WHATSAPP' &&
        template.approvalStatus != null &&
        template.approvalStatus !== 'DRAFT';

    // ── Form state ──
    const [type, setType] = useState<TemplateType>(template?.type ?? 'INTERNAL');
    const [friendlyName, setFriendlyName] = useState(template?.friendlyName ?? '');
    const [name, setName] = useState(template?.name ?? '');
    const [nameTouched, setNameTouched] = useState(isEdit);
    const [channel, setChannel] = useState<TemplateChannel>(template?.channel ?? 'WHATSAPP');
    const [language, setLanguage] = useState(template?.language ?? 'en');
    const [category, setCategory] = useState<WaTemplateCategory>(template?.category ?? 'UTILITY');
    const [contentType, setContentType] = useState<WaContentType>(template?.contentType ?? 'TEXT');
    const [subject, setSubject] = useState(template?.subject ?? '');
    const [body, setBody] = useState(template?.body ?? '');
    const [sampleValues, setSampleValues] = useState<Record<string, string>>(
        (template?.sampleValues as Record<string, string>) ?? {},
    );

    const bodyRef = useRef<HTMLTextAreaElement | null>(null);

    const isWhatsApp = type === 'WHATSAPP';
    const isEmail = channel === 'EMAIL';

    // Variables detected live from the body
    const variables = useMemo(() => parseTemplateVariables(body), [body]);
    const previewTokens = useMemo(() => tokenizeBody(body, sampleValues), [body, sampleValues]);

    // ── Name auto-slug from friendlyName (WHATSAPP) until the user edits it ──
    const onFriendlyChange = (val: string) => {
        setFriendlyName(val);
        if (!nameTouched) setName(slugifyName(val));
    };

    const insertField = (label: string) => {
        const marker = `[${label}]`;
        const el = bodyRef.current;
        if (!el) {
            setBody((b) => b + marker);
            return;
        }
        const start = el.selectionStart ?? body.length;
        const end = el.selectionEnd ?? body.length;
        const next = body.slice(0, start) + marker + body.slice(end);
        setBody(next);
        // restore caret after the inserted marker
        requestAnimationFrame(() => {
            el.focus();
            const pos = start + marker.length;
            el.setSelectionRange(pos, pos);
        });
    };

    // ── Validation ──
    const errors: string[] = [];
    if (!friendlyName.trim()) errors.push('Friendly name is required.');
    if (!body.trim()) errors.push('Body is required.');
    if (isWhatsApp && !/^[a-z0-9_]+$/.test(name)) {
        errors.push('WhatsApp name must be lowercase letters, numbers, and underscores.');
    }
    if (!name.trim()) errors.push('Name is required.');
    const canSubmit = errors.length === 0 && !frozen && !isPending;

    const handleSave = () => {
        if (!canSubmit) return;
        const input: CreateTemplateInput = {
            type,
            name: name.trim(),
            friendlyName: friendlyName.trim(),
            channel,
            language: language.trim() || 'en',
            body,
            ...(isEmail ? { subject: subject.trim() || undefined } : {}),
            ...(isWhatsApp
                ? {
                      contentType,
                      category,
                      sampleValues: Object.keys(sampleValues).length ? sampleValues : undefined,
                  }
                : {}),
        };

        startTransition(async () => {
            const result = isEdit
                ? await updateTemplate(template!.id, input)
                : await createTemplate(input);
            const saved = handleResult(result, toast, {
                successMessage: isEdit ? 'Template updated.' : 'Template created.',
                errorTitle: 'Save failed',
            });
            if (!saved) return;
            router.push('/templates');
            router.refresh();
        });
    };

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Link href="/templates" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {isEdit ? 'Edit Template' : 'New Template'}
                        </h1>
                        {template ? (
                            <div className="mt-1 flex items-center gap-2">
                                <TemplateStatusBadge template={template} />
                                {frozen ? (
                                    <span className="text-xs text-muted-foreground">
                                        Submitted templates are frozen — duplicate to edit.
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/templates"><Button variant="ghost">Cancel</Button></Link>
                    <Button onClick={handleSave} disabled={!canSubmit}>
                        {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
                {/* ════════ LEFT: fields ════════ */}
                <div className="space-y-5">
                    {/* Type toggle */}
                    <div className="rounded-2xl border border-border/70 bg-card p-5">
                        <span className={LABEL}>Template type</span>
                        <div className="grid grid-cols-2 gap-3">
                            {([
                                { v: 'INTERNAL' as const, title: 'Internal', desc: 'Quick reply, used inside the 24h window', soon: false },
                                { v: 'WHATSAPP' as const, title: 'WhatsApp', desc: 'Meta-approved, reaches anytime', soon: true },
                            ]).map((opt) => (
                                <button
                                    key={opt.v}
                                    type="button"
                                    disabled={frozen || opt.soon}
                                    title={opt.soon ? 'WhatsApp templates arrive after internal templates ship' : undefined}
                                    onClick={() => { setType(opt.v); if (opt.v === 'WHATSAPP') setChannel('WHATSAPP'); }}
                                    className={`relative rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${type === opt.v ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/70 hover:border-border'}`}
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold">
                                        {opt.title}
                                        {opt.soon ? (
                                            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Soon</span>
                                        ) : null}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">{opt.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Basics */}
                    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5">
                        <div>
                            <label className={LABEL}>Friendly name</label>
                            <Input
                                value={friendlyName}
                                onChange={(e) => onFriendlyChange(e.target.value)}
                                placeholder="Follow-up after quotation"
                                disabled={frozen}
                            />
                            <p className={HINT}>Shown to your team in the picker.</p>
                        </div>

                        <div>
                            <label className={LABEL}>
                                Name {isWhatsApp ? <span className="text-muted-foreground">(Meta identifier)</span> : null}
                            </label>
                            <Input
                                value={name}
                                onChange={(e) => { setNameTouched(true); setName(isWhatsApp ? slugifyName(e.target.value) : e.target.value); }}
                                placeholder="follow_up_quotation"
                                className="font-mono"
                                disabled={frozen}
                            />
                            <p className={HINT}>
                                {isWhatsApp ? 'Lowercase letters, numbers, underscores. Meta requires this format.' : 'Internal identifier.'}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={LABEL}>Channel</label>
                                <Select
                                    value={channel}
                                    onChange={(e) => setChannel(e.target.value as TemplateChannel)}
                                    disabled={frozen || isWhatsApp}
                                >
                                    <option value="WHATSAPP">WhatsApp</option>
                                    <option value="EMAIL">Email</option>
                                </Select>
                                {isWhatsApp ? <p className={HINT}>WhatsApp templates are WhatsApp-only.</p> : null}
                            </div>
                            <div>
                                <label className={LABEL}>Language</label>
                                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" disabled={frozen} />
                            </div>
                        </div>

                        {/* WhatsApp-only meta */}
                        {isWhatsApp ? (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={LABEL}>Category</label>
                                    <Select value={category} onChange={(e) => setCategory(e.target.value as WaTemplateCategory)} disabled={frozen}>
                                        <option value="UTILITY">Utility</option>
                                        <option value="MARKETING">Marketing</option>
                                        <option value="AUTHENTICATION">Authentication</option>
                                    </Select>
                                </div>
                                <div>
                                    <label className={LABEL}>Content type</label>
                                    <Select value={contentType} onChange={(e) => setContentType(e.target.value as WaContentType)} disabled={frozen}>
                                        <option value="TEXT">Text</option>
                                        <option value="MEDIA">Media</option>
                                        <option value="CALL_TO_ACTION">Call to action</option>
                                        <option value="QUICK_REPLY">Quick reply</option>
                                    </Select>
                                </div>
                            </div>
                        ) : null}

                        {/* Email subject */}
                        {isEmail ? (
                            <div>
                                <label className={LABEL}>Subject</label>
                                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your quotation from Acme" disabled={frozen} />
                            </div>
                        ) : null}
                    </div>

                    {/* Body editor */}
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
                        <div className="flex items-center justify-between">
                            <label className={LABEL + ' mb-0'}>Message body</label>
                            <InsertFieldDropdown onInsert={insertField} disabled={frozen} />
                        </div>
                        <textarea
                            ref={bodyRef}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder="Hi [Customer Name], thanks for your interest in [Product]…"
                            rows={6}
                            disabled={frozen}
                            className="w-full resize-y rounded-lg border border-border/60 bg-background p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                        />
                        <p className={HINT}>
                            Wrap variables in square brackets, e.g. <code className="rounded bg-accent px-1">[Customer Name]</code>.
                            Use “Insert Field” for auto-filled fields.
                        </p>

                        {/* Detected variables */}
                        {variables.length > 0 ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {variables.map((v) => {
                                    const sys = isSystemLabel(v.label);
                                    return (
                                        <Badge key={v.label} variant={sys ? 'success' : 'secondary'}>
                                            {v.label} · {sys ? 'auto' : 'manual'}
                                        </Badge>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>

                    {/* Sample values (WhatsApp — Meta requires them; also powers preview) */}
                    {isWhatsApp && variables.length > 0 ? (
                        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
                            <div>
                                <span className={LABEL}>Sample values</span>
                                <p className="-mt-1 text-xs text-muted-foreground">
                                    Meta needs an example for each variable. Also used in the preview.
                                </p>
                            </div>
                            <div className="space-y-2">
                                {variables.map((v) => (
                                    <div key={v.label} className="grid grid-cols-[140px_1fr] items-center gap-3">
                                        <span className="truncate text-sm text-muted-foreground">{v.label}</span>
                                        <Input
                                            value={sampleValues[v.label] ?? ''}
                                            onChange={(e) => setSampleValues((s) => ({ ...s, [v.label]: e.target.value }))}
                                            placeholder={`e.g. ${v.label === 'Customer Name' ? 'Rahul' : 'Example'}`}
                                            disabled={frozen}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {/* Validation summary */}
                    {errors.length > 0 ? (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                            <ul className="list-inside list-disc space-y-0.5">
                                {errors.map((e) => <li key={e}>{e}</li>)}
                            </ul>
                        </div>
                    ) : null}

                    {/* Submit for approval — built but disabled until Step 5 */}
                    {isWhatsApp ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/50 p-4">
                            <Button variant="outline" disabled title="Available in Step 5 (Twilio approval)">
                                Submit for approval
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                Save the draft now. Submitting to Meta for approval arrives in the next step.
                            </span>
                        </div>
                    ) : null}
                </div>

                {/* ════════ RIGHT: live preview ════════ */}
                <div className="lg:sticky lg:top-6 lg:self-start">
                    <div className="rounded-2xl border border-border/70 bg-card p-5">
                        <div className="mb-4 flex items-center justify-between">
                            <span className="text-sm font-medium">Live preview</span>
                            <span className="text-xs text-muted-foreground">{isEmail ? 'Email' : 'WhatsApp'}</span>
                        </div>

                        {/* Phone-ish chat frame */}
                        <div className="rounded-2xl bg-[#e7ddd1] p-4 dark:bg-[#0b141a]">
                            {isEmail && subject ? (
                                <div className="mb-2 rounded-lg bg-background/90 px-3 py-2 text-xs font-semibold text-foreground shadow-sm">
                                    {subject}
                                </div>
                            ) : null}
                            <div className="ml-auto max-w-[85%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm leading-relaxed text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-white">
                                {body.trim() ? (
                                    <PreviewBody tokens={previewTokens} />
                                ) : (
                                    <span className="italic opacity-60">Your message preview appears here…</span>
                                )}
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                            Filled variables show your sample value; empty ones show a highlighted placeholder.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PreviewBody({ tokens }: { tokens: ReturnType<typeof tokenizeBody> }) {
    return (
        <span className="whitespace-pre-wrap">
            {tokens.map((t, i) =>
                t.type === 'text' ? (
                    <span key={i}>{t.value}</span>
                ) : t.value ? (
                    <span key={i} className="font-medium">{t.value}</span>
                ) : (
                    <span key={i} className="rounded bg-black/10 px-1 text-[0.85em] font-medium dark:bg-white/15">
                        {t.label}
                    </span>
                ),
            )}
        </span>
    );
}
