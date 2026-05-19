'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSocket } from '@/lib/socket';
import { getOutboundMessages, OutboundMessage, DeliveryStatus } from '@/services/messaging/outbound.service';
import { RetryButton } from './RetryButton';

interface Props {
    enquiryId: string;
    initialMessages: OutboundMessage[];
}

type Item =
    | { kind: 'separator'; key: string; label: string }
    | { kind: 'message'; message: OutboundMessage };

// WhatsApp-style delivery ticks
function StatusTick({ status }: { status: DeliveryStatus }) {
    if (status === 'PENDING') {
        return (
            <svg className="w-3 h-3 opacity-50" viewBox="0 0 16 16" fill="none" aria-label="Pending">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        );
    }
    if (status === 'SENT') {
        return (
            <svg className="w-3.5 h-3 opacity-60" viewBox="0 0 14 10" fill="none" aria-label="Sent">
                <path d="M1 5L5 9L13 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (status === 'DELIVERED') {
        return (
            <svg className="w-5 h-3 opacity-60" viewBox="0 0 20 10" fill="none" aria-label="Delivered">
                <path d="M1 5L5 9L13 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 5L11 9L19 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (status === 'READ') {
        return (
            <svg className="w-5 h-3 text-sky-300" viewBox="0 0 20 10" fill="none" aria-label="Read">
                <path d="M1 5L5 9L13 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 5L11 9L19 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    return null;
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
}

function getDateKey(dateStr: string): string {
    return new Date(dateStr).toDateString();
}

function ChannelPip({ channel }: { channel: string }) {
    if (channel === 'EMAIL') {
        return (
            <span className="inline-flex items-center gap-0.5 text-[9px] opacity-50 font-medium tracking-wide">
                <svg className="w-2 h-2" viewBox="0 0 12 9" fill="currentColor">
                    <path d="M11 0H1C.448 0 0 .448 0 1v7c0 .552.448 1 1 1h10c.552 0 1-.448 1-1V1c0-.552-.448-1-1-1zM9.9 1L6 3.894 2.1 1H9.9zM1 8V1.94l4.469 3.19a.5.5 0 00.562 0L10.5 1.94V8H1z" />
                </svg>
                EMAIL
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-0.5 text-[9px] opacity-50 font-medium tracking-wide">
            <svg className="w-2 h-2" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 0C2.686 0 0 2.686 0 6c0 1.059.276 2.053.76 2.912L0 12l3.173-.832A5.97 5.97 0 006 12c3.314 0 6-2.686 6-6S9.314 0 6 0zm0 10.875c-.97 0-1.874-.259-2.652-.708l-.19-.112-1.883.494.503-1.832-.124-.199A4.864 4.864 0 011.125 6C1.125 3.311 3.311 1.125 6 1.125S10.875 3.311 10.875 6 8.689 10.875 6 10.875z" />
            </svg>
            WA
        </span>
    );
}

export function OutboundHistory({ enquiryId, initialMessages }: Props) {
    const [messages, setMessages] = useState<OutboundMessage[]>(initialMessages);
    const bottomRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        const res = await getOutboundMessages(enquiryId);
        setMessages(res.data);
    }, [enquiryId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    useEffect(() => {
        let mounted = true;
        const offFns: (() => void)[] = [];

        getSocket().then((sock) => {
            if (!mounted) return;

            const onSent = (payload: { messageId: string }) => {
                setMessages((prev) => {
                    const exists = prev.find((m) => m.id === payload.messageId);
                    if (exists) {
                        return prev.map((m) =>
                            m.id === payload.messageId ? { ...m, deliveryStatus: 'SENT' } : m,
                        );
                    }
                    return prev;
                });
                void refresh();
            };

            const onDeliveryUpdated = (payload: {
                messageId: string;
                deliveryStatus: DeliveryStatus;
                deliveredAt?: string;
                readAt?: string;
            }) => {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === payload.messageId
                            ? {
                                ...m,
                                deliveryStatus: payload.deliveryStatus,
                                deliveredAt: payload.deliveredAt ?? m.deliveredAt,
                                readAt: payload.readAt ?? m.readAt,
                            }
                            : m,
                    ),
                );
            };

            const onFailed = (payload: { messageId: string }) => {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === payload.messageId ? { ...m, deliveryStatus: 'FAILED' } : m,
                    ),
                );
            };

            sock.on('outbound:sent', onSent);
            sock.on('outbound:delivery_updated', onDeliveryUpdated);
            sock.on('outbound:failed', onFailed);

            offFns.push(
                () => sock.off('outbound:sent', onSent),
                () => sock.off('outbound:delivery_updated', onDeliveryUpdated),
                () => sock.off('outbound:failed', onFailed),
            );
        });

        return () => {
            mounted = false;
            offFns.forEach((fn) => fn());
        };
    }, [enquiryId, refresh]);

    if (messages.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-20 gap-3 select-none">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-2xl">
                    💬
                </div>
                <p className="text-sm text-muted-foreground font-medium">No messages yet</p>
                <p className="text-xs text-muted-foreground/60">Send the first message below</p>
            </div>
        );
    }

    // Build flat list with date separators
    const items: Item[] = [];
    let lastDateKey = '';

    for (const msg of messages) {
        const dk = getDateKey(msg.createdAt);
        if (dk !== lastDateKey) {
            lastDateKey = dk;
            items.push({ kind: 'separator', key: `sep-${dk}`, label: formatDateLabel(msg.createdAt) });
        }
        items.push({ kind: 'message', message: msg });
    }

    return (
        <div className="px-4 py-4 flex flex-col gap-0.5">
            {items.map((item) => {
                if (item.kind === 'separator') {
                    return (
                        <div key={item.key} className="flex items-center justify-center my-3">
                            <span className="text-[11px] text-muted-foreground bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-3 py-0.5 rounded-full border border-border/40 select-none">
                                {item.label}
                            </span>
                        </div>
                    );
                }

                const { message: msg } = item;
                const isFailed = msg.deliveryStatus === 'FAILED';
                const isEmail = msg.channel === 'EMAIL';
                const sender = msg.sentByUser?.displayName ?? msg.sentByUser?.userName ?? null;

                return (
                    <div key={msg.id} className="flex justify-end animate-slide-in-bottom">
                        <div className="max-w-[72%] min-w-[6rem]">
                            <div
                                className={[
                                    'rounded-2xl rounded-br-sm px-3.5 py-2.5 shadow-sm',
                                    isFailed
                                        ? 'bg-red-800/80 dark:bg-red-900/70 text-red-50'
                                        : 'bg-slate-800 dark:bg-slate-700 text-slate-50',
                                ].join(' ')}
                            >
                                {/* Email subject label */}
                                {isEmail && msg.subject && (
                                    <p className="text-[11px] font-semibold mb-1.5 pb-1.5 border-b border-white/10 opacity-80 tracking-wide">
                                        {msg.subject}
                                    </p>
                                )}

                                {/* Message body */}
                                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>

                                {/* Footer: time + channel pip + status */}
                                <div className="flex items-center justify-end gap-1.5 mt-1.5 select-none">
                                    <ChannelPip channel={msg.channel} />
                                    {sender && (
                                        <span className="text-[9px] opacity-50 truncate max-w-[80px]">{sender}</span>
                                    )}
                                    <span className="text-[10px] opacity-50 shrink-0">
                                        {formatTime(msg.createdAt)}
                                    </span>
                                    {isFailed ? (
                                        <RetryButton messageId={msg.id} onRetried={refresh} />
                                    ) : (
                                        <StatusTick status={msg.deliveryStatus} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}
