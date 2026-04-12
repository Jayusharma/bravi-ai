'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    getConversationThread,
    type ConversationThread,
    type EnquiryThread,
    type ThreadMessage,
} from '@/services/dashboard/conversation.services';
import { getSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import styles from '@/styles/ContactList.module.css';

interface ChatViewProps {
    contactId: string;
    contactName: string;
}

const CHANNEL_LABELS: Record<string, { icon: string; label: string }> = {
    WHATSAPP: { icon: '💬', label: 'WhatsApp' },
    EMAIL: { icon: '📧', label: 'Email' },
    SMS: { icon: '📱', label: 'SMS' },
};

const STATUS_COLORS: Record<string, string> = {
    NEW: '#22c55e',
    QUALIFICATION: '#eab308',
    OPEN: '#3b82f6',
    IN_PROGRESS: '#8b5cf6',
    AWAITING_CUSTOMER: '#f59e0b',
    QUOTATION_SENT: '#ec4899',
    FOLLOW_UP: '#06b6d4',
    STALE: '#6b7280',
    CONVERTED: '#10b981',
    CLOSED_LOST: '#6b7280',
};

// ── Helpers ──────────────────────────────────────────────────────

function formatMsgTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDateSeparator(dateStr: string) {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDateLabel(msg: ThreadMessage, prev: ThreadMessage | null): string | null {
    const d = new Date(msg.createdAt).toDateString();
    const p = prev ? new Date(prev.createdAt).toDateString() : null;
    return d !== p ? formatDateSeparator(msg.createdAt) : null;
}

// ── Sub-component: single enquiry thread ─────────────────────────

function EnquiryBlock({ enq, newMessageIds }: { enq: EnquiryThread; newMessageIds: Set<string> }) {
    const statusColor = STATUS_COLORS[enq.status] || '#6b7280';

    return (
        <div className={styles.enquiryBlock}>
            {/* Enquiry header — separates different enquiries */}
            <div className={styles.enquiryDivider}>
                <span className={styles.enquiryDividerLine} />
                <span
                    className={styles.enquiryDividerBadge}
                    style={{ color: statusColor, borderColor: statusColor, background: `${statusColor}18` }}
                >
                    {enq.status.replace(/_/g, ' ')}
                    {enq.assignedTo && (
                        <span className={styles.enquiryDividerAssigned}>
                            · {enq.assignedTo.displayName || enq.assignedTo.userName}
                        </span>
                    )}
                    <span className={styles.enquiryDividerDate}>
                        {new Date(enq.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                        })}
                    </span>
                </span>
                <span className={styles.enquiryDividerLine} />
            </div>

            {/* Messages for this enquiry */}
            {enq.messages.length === 0 ? (
                <div className={styles.chatEmpty}>No messages in this thread</div>
            ) : (
                enq.messages.map((msg, i) => {
                    const prev = i > 0 ? enq.messages[i - 1] : null;
                    const dateLabel = getDateLabel(msg, prev);
                    const isInbound = msg.direction === 'INBOUND';
                    const isNew = newMessageIds.has(msg.id);

                    return (
                        <div key={msg.id} className={isNew ? styles.msgNew : undefined}>
                            {dateLabel && (
                                <div className={styles.dateSeparator}>
                                    <span>{dateLabel}</span>
                                </div>
                            )}
                            <div className={`${styles.msgRow} ${isInbound ? styles.msgInbound : styles.msgOutbound}`}>
                                <div className={`${styles.msgBubble} ${isInbound ? styles.bubbleInbound : styles.bubbleOutbound}`}>
                                    {/* Staff sender name on outbound */}
                                    {!isInbound && msg.sentByUser && (
                                        <div className={styles.msgSenderName}>
                                            {msg.sentByUser.displayName || msg.sentByUser.userName}
                                        </div>
                                    )}

                                    <div className={styles.msgContent}>{msg.content}</div>

                                    <div className={styles.msgFooter}>
                                        <span className={styles.msgTime}>{formatMsgTime(msg.createdAt)}</span>
                                        {!isInbound && (
                                            <span className={styles.deliveryStatus}>
                                                {msg.deliveryStatus === 'READ' ? '✓✓' :
                                                    msg.deliveryStatus === 'DELIVERED' ? '✓✓' :
                                                        msg.deliveryStatus === 'SENT' ? '✓' : '🕐'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}

// ── Main ChatView ─────────────────────────────────────────────────

export default function ChatView({ contactId, contactName }: ChatViewProps) {
    const [thread, setThread] = useState<ConversationThread | null>(null);
    const [loading, setLoading] = useState(true);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
    const bottomRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);

    // ── Load thread from API ──
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const data = await getConversationThread(contactId);
                if (!cancelled) setThread(data);
            } catch (err) {
                console.error('Failed to load thread:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [contactId]);

    // ── WebSocket: Real-time new messages ──
    useEffect(() => {
        let mounted = true;

        async function setupSocket() {
            try {
                const sock = await getSocket();
                if (!mounted) return;
                socketRef.current = sock;

                sock.on('chat:new-message', (data: {
                    contactId: string;
                    enquiryId: string;
                    message: ThreadMessage;
                }) => {
                    if (!mounted) return;
                    if (data.contactId !== contactId) return; // Not for this chat

                    setThread(prev => {
                        if (!prev) return prev;

                        // Find the enquiry this message belongs to
                        const updatedEnquiries = prev.enquiries.map(enq => {
                            if (enq.enquiryId === data.enquiryId) {
                                // Check for duplicates
                                if (enq.messages.some(m => m.id === data.message.id)) {
                                    return enq;
                                }
                                return {
                                    ...enq,
                                    messages: [...enq.messages, data.message],
                                    messageCount: enq.messageCount + 1,
                                };
                            }
                            return enq;
                        });

                        return { ...prev, enquiries: updatedEnquiries };
                    });

                    // Track as "new" for animation
                    setNewMessageIds(prev => new Set(prev).add(data.message.id));

                    // Remove animation class after 1s
                    setTimeout(() => {
                        setNewMessageIds(prev => {
                            const next = new Set(prev);
                            next.delete(data.message.id);
                            return next;
                        });
                    }, 1000);
                });

            } catch (err) {
                console.error('Chat WebSocket setup failed:', err);
            }
        }

        setupSocket();

        return () => {
            mounted = false;
            socketRef.current?.off('chat:new-message');
        };
    }, [contactId]);

    // ── Auto-scroll to bottom when new messages arrive ──
    useEffect(() => {
        if (!loading && thread) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [thread, loading]);

    if (loading) {
        return (
            <div className={styles.chatView}>
                <div className={styles.chatLoading}>Loading messages...</div>
            </div>
        );
    }

    if (!thread) {
        return (
            <div className={styles.chatView}>
                <div className={styles.chatLoading}>Failed to load conversation</div>
            </div>
        );
    }

    // Most recent enquiry — the active one
    const activeEnquiry = thread.enquiries[0];
    const primaryChannel = thread.contact.channels?.[0];
    const channelInfo = CHANNEL_LABELS[primaryChannel?.channel || ''] || { icon: '💭', label: 'Chat' };
    const statusColor = STATUS_COLORS[activeEnquiry?.status || ''] || '#6b7280';

    return (
        <div className={styles.chatView}>

            {/* ── Chat Header ──────────────────────────────────── */}
            <div className={styles.chatHeader}>
                <div className={styles.chatHeaderAvatar}>
                    {thread.contact.displayName.charAt(0).toUpperCase()}
                </div>

                <div className={styles.chatHeaderInfo}>
                    <div className={styles.chatHeaderName}>{thread.contact.displayName}</div>
                    <div className={styles.chatHeaderMeta}>
                        <span>{channelInfo.icon} {channelInfo.label}</span>
                        {primaryChannel && (
                            <span className={styles.chatHeaderPhone}>· {primaryChannel.identifier}</span>
                        )}
                    </div>
                </div>

                {activeEnquiry && (
                    <div className={styles.chatHeaderRight}>
                        <span
                            className={styles.chatStatusBadge}
                            style={{
                                background: `${statusColor}22`,
                                color: statusColor,
                                borderColor: statusColor,
                            }}
                        >
                            {activeEnquiry.status.replace(/_/g, ' ')}
                        </span>
                        {activeEnquiry.assignedTo && (
                            <span className={styles.chatAssigned}>
                                {activeEnquiry.assignedTo.displayName || activeEnquiry.assignedTo.userName}
                            </span>
                        )}
                        <span className={styles.enquiryCount}>
                            {thread.enquiries.length} {thread.enquiries.length === 1 ? 'thread' : 'threads'}
                        </span>
                    </div>
                )}
            </div>

            {/* ── Messages Area — all enquiry blocks ───────────── */}
            <div className={styles.chatMessages}>
                {thread.enquiries.length === 0 ? (
                    <div className={styles.chatEmpty}>No conversations yet</div>
                ) : (
                    [...thread.enquiries].reverse().map((enq) => (
                        <EnquiryBlock
                            key={enq.enquiryId}
                            enq={enq}
                            newMessageIds={newMessageIds}
                        />
                    ))
                )}
                <div ref={bottomRef} />
            </div>

            {/* ── Composer (visual only — outbound in next phase) ── */}
            <div className={styles.composer}>
                <input
                    type="text"
                    className={styles.composerInput}
                    placeholder="Outbound messaging coming soon..."
                    disabled
                />
                <button className={styles.composerBtn} disabled>➤</button>
            </div>

        </div>
    );
}