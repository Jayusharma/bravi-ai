'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import {
    OutboundDraft,
    MessageChannel,
    createDraft,
    updateDraft,
    sendDraft,
} from '@/services/messaging/outbound.service';
import { DraftSaveState } from './DraftStatusBar';
import { ConfirmSendDialog } from './ConfirmSendDialog';

interface Props {
    enquiryId: string;
    contactChannel: MessageChannel;
    recipientAddress: string;
    initialDraft: OutboundDraft | null;
    onMessageSent?: () => void;
}

const CHANNELS: { value: MessageChannel; label: string; icon: string }[] = [
    { value: 'WHATSAPP', label: 'WhatsApp', icon: '💬' },
    { value: 'EMAIL', label: 'Email', icon: '✉️' },
];

function formatRelative(date: Date): string {
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
}

export function OutboundComposer({
    enquiryId,
    contactChannel,
    recipientAddress,
    initialDraft,
    onMessageSent,
}: Props) {
    const [draft, setDraft] = useState<OutboundDraft | null>(initialDraft);
    const [channel, setChannel] = useState<MessageChannel>(initialDraft?.channel ?? contactChannel);
    const [subject, setSubject] = useState(initialDraft?.subject ?? '');
    const [body, setBody] = useState(initialDraft?.body ?? '');

    const [saveState, setSaveState] = useState<DraftSaveState>('idle');
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    const [showConfirm, setShowConfirm] = useState(false);
    const [sending, setSending] = useState(false);

    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const saveDraft = useCallback(async (): Promise<OutboundDraft | null> => {
        if (!body.trim() && !subject.trim()) return draft;
        setSaveState('saving');
        try {
            let saved: OutboundDraft;
            if (draft) {
                saved = await updateDraft(draft.id, { channel, subject, body });
            } else {
                saved = await createDraft(enquiryId, { channel, subject, body });
            }
            setDraft(saved);
            setIsDirty(false);
            setSaveState('saved');
            setSavedAt(new Date());
            return saved;
        } catch {
            setSaveState('error');
            return null;
        }
    }, [draft, enquiryId, channel, subject, body]);

    useEffect(() => {
        let mounted = true;
        let offFn: (() => void) | undefined;

        getSocket().then((sock) => {
            if (!mounted) return;

            const onSent = (payload: { messageId: string; enquiryId: string }) => {
                if (payload.enquiryId !== enquiryId) return;
                setBody('');
                setSubject('');
                setDraft(null);
                setIsDirty(false);
                setSaveState('idle');
                onMessageSent?.();
            };

            sock.on('outbound:sent', onSent);
            offFn = () => sock.off('outbound:sent', onSent);
        });

        return () => {
            mounted = false;
            offFn?.();
        };
    }, [enquiryId, onMessageSent]);

    useEffect(() => {
        if (!isDirty) return;
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => saveDraft(), 30_000);
        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [body, subject, channel, isDirty, saveDraft]);

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }, [body]);

    const markDirty = () => {
        setIsDirty(true);
        setSaveState('dirty');
    };

    const handleSend = async () => {
        let activeDraft = draft;
        if (!activeDraft || isDirty) {
            activeDraft = await saveDraft();
        }
        if (!activeDraft) {
            setShowConfirm(false);
            return;
        }
        setSending(true);
        try {
            await sendDraft(activeDraft.id);
            // Socket 'outbound:sent' resets the form
        } catch (err) {
            console.error('Send failed:', err);
        } finally {
            setSending(false);
            setShowConfirm(false);
        }
    };

    const draftHint =
        saveState === 'saving' ? 'Saving…' :
            saveState === 'saved' && savedAt ? `Draft saved ${formatRelative(savedAt)}` :
                saveState === 'dirty' ? 'Unsaved' :
                    saveState === 'error' ? 'Save failed' : '';

    return (
        <div className="px-3 pt-2.5 pb-3">
            {/* Channel tabs + recipient */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex gap-0.5 p-0.5 bg-muted/60 rounded-lg">
                    {CHANNELS.map((ch) => (
                        <button
                            key={ch.value}
                            type="button"
                            onClick={() => { setChannel(ch.value); markDirty(); }}
                            className={[
                                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                                channel === ch.value
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            ].join(' ')}
                        >
                            <span className="text-[13px]">{ch.icon}</span>
                            {ch.label}
                        </button>
                    ))}
                </div>
                <span className="text-[11px] text-muted-foreground/60 truncate max-w-[45%]">
                    → {recipientAddress}
                </span>
            </div>

            {/* Email subject */}
            {channel === 'EMAIL' && (
                <input
                    type="text"
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); markDirty(); }}
                    placeholder="Subject"
                    className="w-full mb-2 px-3 py-1.5 text-sm bg-muted/40 border border-border/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 transition-colors"
                />
            )}

            {/* Input row */}
            <div className="flex items-end gap-2">
                <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => { setBody(e.target.value); markDirty(); }}
                    placeholder={channel === 'EMAIL' ? 'Write your message…' : 'Message'}
                    rows={1}
                    className="flex-1 px-4 py-2.5 text-sm bg-muted/40 border border-border/50 rounded-2xl focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50 leading-relaxed transition-colors"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && channel === 'WHATSAPP') {
                            e.preventDefault();
                            if (body.trim()) setShowConfirm(true);
                        }
                    }}
                />
                <button
                    type="button"
                    disabled={!body.trim() || sending}
                    onClick={() => setShowConfirm(true)}
                    className="w-10 h-10 rounded-full bg-slate-800 dark:bg-slate-600 text-white flex items-center justify-center shrink-0 disabled:opacity-35 hover:bg-slate-700 dark:hover:bg-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    aria-label="Send message"
                >
                    <svg className="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                </button>
            </div>

            {/* Draft status hint */}
            {draftHint && (
                <p className={`mt-1.5 text-[10px] text-right ${saveState === 'error' ? 'text-destructive' : 'text-muted-foreground/50'}`}>
                    {draftHint}
                </p>
            )}

            <ConfirmSendDialog
                open={showConfirm}
                channel={channel}
                recipient={recipientAddress}
                subject={subject}
                bodyPreview={body}
                sending={sending}
                onConfirm={handleSend}
                onCancel={() => setShowConfirm(false)}
            />
        </div>
    );
}
