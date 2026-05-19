'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { EnquiryDetail } from '@/services/messaging/enquiry.service';
import { OutboundDraft, OutboundMessage } from '@/services/messaging/outbound.service';
import { OutboundComposer } from '@/components/outbound/OutboundComposer';
import { OutboundHistory } from '@/components/outbound/OutboundHistory';

const STATUS_COLOR: Record<string, string> = {
    NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    OPEN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    IN_PROGRESS: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    AWAITING_CUSTOMER: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    QUOTATION_SENT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    FOLLOW_UP: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
    STALE: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    CONVERTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    CLOSED_LOST: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

interface Props {
    enquiry: EnquiryDetail;
    initialDraft: OutboundDraft | null;
    initialMessages: OutboundMessage[];
    recipientChannel: 'EMAIL' | 'WHATSAPP';
    recipientAddress: string;
}

export function EnquiryDetailClient({
    enquiry,
    initialDraft,
    initialMessages,
    recipientChannel,
    recipientAddress,
}: Props) {
    const [historyKey, setHistoryKey] = useState(0);

    useEffect(() => {
        let sock: Awaited<ReturnType<typeof getSocket>> | null = null;
        getSocket().then((s) => {
            sock = s;
            s.emit('enquiry:join', { enquiryId: enquiry.id });
        });
        return () => {
            sock?.emit('enquiry:leave', { enquiryId: enquiry.id });
        };
    }, [enquiry.id]);

    const refreshHistory = () => setHistoryKey((k) => k + 1);

    const initials = enquiry.contact.displayName
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();

    return (
        // Break out of the dashboard padding wrapper to fill full height
        <div className="-mx-4 -my-4 md:-mx-8 md:-my-8 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 80px)' }}>

            {/* ── Chat header ── */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-background shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0 select-none">
                        {initials}
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{enquiry.contact.displayName}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {enquiry.contact.organization && (
                                <span className="text-xs text-muted-foreground">{enquiry.contact.organization}</span>
                            )}
                            {enquiry.contact.channels.map((ch) => (
                                <span key={ch.id} className="text-xs text-muted-foreground/70">
                                    {ch.identifier}
                                    {ch.isPrimary && <span className="ml-0.5 text-[9px] opacity-60">★</span>}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[enquiry.status] ?? 'bg-muted text-muted-foreground'}`}>
                        {enquiry.status.replace(/_/g, ' ')}
                    </span>
                    {enquiry.assignedTo && (
                        <span className="text-[11px] text-muted-foreground">
                            {enquiry.assignedTo.displayName ?? enquiry.assignedTo.userName}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Messages area ── */}
            <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
                <OutboundHistory
                    key={historyKey}
                    enquiryId={enquiry.id}
                    initialMessages={initialMessages}
                />
            </div>

            {/* ── Composer ── */}
            <div className="shrink-0 border-t border-border/60 bg-background">
                {recipientAddress ? (
                    <OutboundComposer
                        enquiryId={enquiry.id}
                        contactChannel={recipientChannel}
                        recipientAddress={recipientAddress}
                        initialDraft={initialDraft}
                        onMessageSent={refreshHistory}
                    />
                ) : (
                    <p className="px-4 py-3 text-sm text-muted-foreground text-center">
                        No contact channel configured. Add an email or phone number to send messages.
                    </p>
                )}
            </div>
        </div>
    );
}
