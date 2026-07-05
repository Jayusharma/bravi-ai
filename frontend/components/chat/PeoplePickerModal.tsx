'use client';

// PeoplePickerModal — pick one or many teammates from the org roster.
// Used by: DM start (single), Create Channel (multi), Add People (multi).
// The roster = members of #general (everyone is a member of it by migration),
// fetched via getChatMembers — readable by every role, unlike GET /users.

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getChatMembers, type ChatMember } from '@/services/chat/chat.service';

interface PeoplePickerModalProps {
    title: string;
    confirmLabel: string;
    /** #general's conversation id — the roster source */
    rosterConversationId: string;
    /** Users to hide (already members, yourself, …) */
    excludeUserIds?: string[];
    multi?: boolean;
    onConfirm: (userIds: string[]) => void | Promise<void>;
    onClose: () => void;
}

export function PeoplePickerModal({
    title,
    confirmLabel,
    rosterConversationId,
    excludeUserIds = [],
    multi = false,
    onConfirm,
    onClose,
}: PeoplePickerModalProps) {
    const [roster, setRoster] = useState<ChatMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let active = true;
        getChatMembers(rosterConversationId)
            .then((m) => { if (active) setRoster(m); })
            .catch(() => { /* roster unavailable */ })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [rosterConversationId]);

    const visible = useMemo(() => {
        const excluded = new Set(excludeUserIds);
        const term = search.trim().toLowerCase();
        return roster.filter((m) => {
            if (excluded.has(m.userId)) return false;
            if (!term) return true;
            return (m.displayName || m.userName).toLowerCase().includes(term);
        });
    }, [roster, excludeUserIds, search]);

    const toggle = (userId: string) => {
        setSelected((prev) => {
            const next = new Set(multi ? prev : []); // single-select replaces
            if (prev.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const handleConfirm = async () => {
        if (selected.size === 0 || submitting) return;
        setSubmitting(true);
        await onConfirm([...selected]);
        setSubmitting(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                    <h3 className="text-base font-semibold">{title}</h3>
                    <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-3">
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" autoFocus />
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    {loading ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Loading people…</p>
                    ) : visible.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No one to add.</p>
                    ) : (
                        visible.map((m) => {
                            const isSelected = selected.has(m.userId);
                            return (
                                <button
                                    key={m.userId}
                                    type="button"
                                    onClick={() => toggle(m.userId)}
                                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors cursor-pointer ${
                                        isSelected ? 'bg-indigo-500/10' : 'hover:bg-accent/60'
                                    }`}
                                >
                                    <Avatar fallback={m.displayName || m.userName} size="sm" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{m.displayName || m.userName}</div>
                                        <div className="text-xs text-muted-foreground">{m.role}</div>
                                    </div>
                                    {isSelected && (
                                        <svg className="h-4 w-4 shrink-0 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={selected.size === 0 || submitting}>
                        {submitting ? 'Working…' : confirmLabel}{multi && selected.size > 0 ? ` (${selected.size})` : ''}
                    </Button>
                </div>
            </div>
        </div>
    );
}
