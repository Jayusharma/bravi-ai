'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    getConversationThread,
    type ConversationThread,
    type EnquiryThread,
    type ThreadMessage,
} from '@/services/dashboard/conversation.services';
import { createDraft, updateDraft, sendDraft } from '@/services/messaging/outbound.service';
import { getSocket, joinEnquiryRoom, leaveEnquiryRoom } from '@/lib/socket';
import { useUpload } from '@/hooks/useUpload';
import { AttachmentPreview } from '@/components/messaging/AttachmentPreview';
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

// ── Message grouping ──────────────────────────────────────────────

type GroupPos = 'single' | 'first' | 'middle' | 'last';

interface MessageGroup {
    msgs: ThreadMessage[];
    pos: GroupPos[];       // position of each msg within the group
    dateLabel: string | null; // sticky date shown before first msg of group
}

function buildMessageGroups(messages: ThreadMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < messages.length) {
        const base = messages[i];
        let j = i + 1;

        // Accumulate consecutive messages from the same sender/direction within 2 min
        while (
            j < messages.length &&
            messages[j].direction === base.direction &&
            messages[j].channel === base.channel &&
            (messages[j].sentByUser?.id ?? null) === (base.sentByUser?.id ?? null) &&
            new Date(messages[j].createdAt).getTime() - new Date(messages[j - 1].createdAt).getTime() < 120_000
        ) {
            j++;
        }

        const groupMsgs = messages.slice(i, j);
        const len = groupMsgs.length;
        const pos: GroupPos[] = groupMsgs.map((_, idx) => {
            if (len === 1) return 'single';
            if (idx === 0) return 'first';
            if (idx === len - 1) return 'last';
            return 'middle';
        });

        // Date separator: shown when date changes from previous group's last message
        const prevLastMsg = groups.length > 0 ? groups[groups.length - 1].msgs.at(-1) : null;
        const curDate = new Date(base.createdAt).toDateString();
        const prevDate = prevLastMsg ? new Date(prevLastMsg.createdAt).toDateString() : null;
        const dateLabel = curDate !== prevDate ? formatDateSeparator(base.createdAt) : null;

        groups.push({ msgs: groupMsgs, pos, dateLabel });
        i = j;
    }

    return groups;
}

// ── Sub-component: single enquiry thread ─────────────────────────

function EnquiryBlock({ enq, newMessageIds, activeChannel }: { enq: EnquiryThread; newMessageIds: Set<string>; activeChannel: 'WHATSAPP' | 'EMAIL' }) {
    const statusColor = STATUS_COLORS[enq.status] || '#6b7280';
    const filteredMessages = enq.messages.filter(msg => msg.channel === activeChannel);

    if (filteredMessages.length === 0) return null;

    const groups = buildMessageGroups(filteredMessages);

    return (
        <div className={styles.enquiryBlock}>
            {/* Enquiry header */}
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

            {groups.map((group, gi) => {
                if (activeChannel === 'EMAIL') {
                    return group.msgs.map((msg) => {
                        const isInbound = msg.direction === 'INBOUND';
                        return (
                            <div key={msg.id}>
                                {group.dateLabel && gi === 0 && (
                                    <div className={styles.dateSeparatorSticky}>
                                        <span>{group.dateLabel}</span>
                                    </div>
                                )}
                                <div className={`${styles.emailCard} ${newMessageIds.has(msg.id) ? styles.msgNew : ''}`}>
                                    <div className={styles.emailCardHeader}>
                                        <div className={styles.emailCardHeaderLeft}>
                                            <div className={styles.emailAvatar}>{isInbound ? 'C' : 'S'}</div>
                                            <div className={styles.emailMeta}>
                                                <div className={styles.emailSender}>
                                                    {isInbound ? msg.from : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff')}
                                                </div>
                                                <div className={styles.emailTo}>to {isInbound ? (msg.to || 'us') : msg.to}</div>
                                            </div>
                                        </div>
                                        <div className={styles.emailTime}>{formatMsgTime(msg.createdAt)}</div>
                                    </div>
                                    {msg.subject && <div className={styles.emailSubject}>Subject: {msg.subject}</div>}
                                    <div className={styles.emailBody}>{msg.content}</div>
                                </div>
                            </div>
                        );
                    });
                }

                // WhatsApp-style grouped bubbles
                return (
                    <div key={`group-${gi}`}>
                        {group.dateLabel && (
                            <div className={styles.dateSeparatorSticky}>
                                <span>{group.dateLabel}</span>
                            </div>
                        )}
                        {group.msgs.map((msg, mi) => {
                            const isInbound = msg.direction === 'INBOUND';
                            const pos = group.pos[mi];
                            const isLast = pos === 'last' || pos === 'single';
                            const isFirst = pos === 'first' || pos === 'single';

                            const rowClass = [
                                styles.msgRow,
                                isInbound ? styles.msgInbound : styles.msgOutbound,
                                pos === 'single' ? styles.msgGroupSingle :
                                pos === 'first'  ? styles.msgGroupFirst :
                                pos === 'last'   ? styles.msgGroupLast :
                                                   styles.msgGroupMiddle,
                                newMessageIds.has(msg.id) ? styles.msgNew : '',
                            ].filter(Boolean).join(' ');

                            const bubbleClass = [
                                styles.msgBubble,
                                isInbound ? styles.bubbleInbound : styles.bubbleOutbound,
                                pos === 'middle' ? styles.bubbleGroupMiddle :
                                isFirst ? (isInbound ? styles.bubbleGroupFirst : styles.bubbleGroupFirst) :
                                isLast  ? (isInbound ? styles.bubbleGroupLast  : styles.bubbleGroupLast)  : '',
                            ].filter(Boolean).join(' ');

                            return (
                                <div key={msg.id} className={rowClass}>
                                    {/* Inbound: show avatar on last bubble, spacer on others */}
                                    {isInbound && (
                                        isLast
                                            ? <div className={styles.msgInlineAvatar}>{msg.from?.charAt(0)?.toUpperCase() ?? 'C'}</div>
                                            : <div className={styles.msgAvatarPlaceholder} />
                                    )}

                                    <div className={bubbleClass}>
                                        {/* Staff sender name — only on first bubble of outbound group */}
                                        {!isInbound && isFirst && msg.sentByUser && (
                                            <div className={styles.msgSenderName}>
                                                {msg.sentByUser.displayName || msg.sentByUser.userName}
                                            </div>
                                        )}

                                        {msg.isDeleted ? (
                                            <div className={styles.msgDeleted}>🚫 This message was deleted</div>
                                        ) : (
                                            <div className={styles.msgContent}>{msg.content}</div>
                                        )}

                                        {/* Timestamp: always visible on last bubble, hover-only on others */}
                                        <div className={`${styles.msgFooterHover} ${isLast ? styles.msgFooterVisible : ''}`}>
                                            <span className={styles.msgTime}>{formatMsgTime(msg.createdAt)}</span>
                                            {msg.editedAt && <span className={styles.editedLabel}>edited</span>}
                                            {!isInbound && (
                                                <span className={styles.deliveryStatus}>
                                                    {msg.deliveryStatus === 'READ'      ? '✓✓' :
                                                     msg.deliveryStatus === 'DELIVERED' ? '✓✓' :
                                                     msg.deliveryStatus === 'SENT'      ? '✓'  : '🕐'}
                                                </span>
                                            )}
                                        </div>

                                        {/* Reactions */}
                                        {msg.reactions && msg.reactions.length > 0 && (
                                            <div className={styles.reactionsBar}>
                                                {msg.reactions.map(r => (
                                                    <span key={r.emoji} className={styles.reactionPill}>
                                                        {r.emoji} {r.count > 1 && r.count}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

// ── Main ChatView ─────────────────────────────────────────────────

export default function ChatView({ contactId, contactName }: ChatViewProps) {
    const [thread, setThread] = useState<ConversationThread | null>(null);
    const [loading, setLoading] = useState(true);
    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
    const [activeChannel, setActiveChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
    const [unseenChannels, setUnseenChannels] = useState<Set<string>>(new Set());
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);
    const prevMsgCountRef = useRef(0);
    const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // ── Load thread from API ──
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const data = await getConversationThread(contactId);
                if (!cancelled) {
                    setThread(data);
                    // Determine the default channel based on the latest message
                    let latestMsgChannel = 'WHATSAPP';
                    let latestMsgTime = 0;
                    data.enquiries.forEach(enq => {
                        if (enq.messages.length > 0) {
                            const lastMsg = enq.messages[enq.messages.length - 1];
                            const time = new Date(lastMsg.createdAt).getTime();
                            if (time > latestMsgTime) {
                                latestMsgTime = time;
                                latestMsgChannel = lastMsg.channel;
                            }
                        }
                    });
                    if (latestMsgChannel === 'EMAIL' || latestMsgChannel === 'WHATSAPP') {
                        setActiveChannel(latestMsgChannel as 'WHATSAPP' | 'EMAIL');
                    }
                }
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
        // Hold cleanup fns so the unmount return can call them
        const offFns: (() => void)[] = [];

        async function setupSocket() {
            try {
                const sock = await getSocket();
                if (!mounted) return;
                socketRef.current = sock;

                const onNewMessage = (data: {
                    contactId: string;
                    enquiryId: string;
                    message: ThreadMessage;
                }) => {
                    if (!mounted) return;
                    if (data.contactId !== contactId) return;

                    setThread(prev => {
                        if (!prev) return prev;
                        const updatedEnquiries = prev.enquiries.map(enq => {
                            if (enq.enquiryId === data.enquiryId) {
                                if (enq.messages.some(m => m.id === data.message.id)) return enq;
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

                    setActiveChannel(currentActive => {
                        if (data.message.channel !== currentActive) {
                            setUnseenChannels(prev => new Set(prev).add(data.message.channel));
                        }
                        return currentActive;
                    });

                    setNewMessageIds(prev => new Set(prev).add(data.message.id));
                    setTimeout(() => {
                        setNewMessageIds(prev => {
                            const next = new Set(prev);
                            next.delete(data.message.id);
                            return next;
                        });
                    }, 1000);
                };

                // Listen for outbound sent confirmations (optimistic → confirmed)
                const onOutboundSent = (payload: { messageId: string; enquiryId: string }) => {
                    if (!mounted) return;
                    setThread(prev => {
                        if (!prev) return prev;
                        const updated = prev.enquiries.map(enq => {
                            if (enq.enquiryId !== payload.enquiryId) return enq;
                            return {
                                ...enq,
                                messages: enq.messages.map(m =>
                                    m.id === payload.messageId
                                        ? { ...m, deliveryStatus: 'SENT' }
                                        : m
                                ),
                            };
                        });
                        return { ...prev, enquiries: updated };
                    });
                };

                // Delivery updates (DELIVERED / READ)
                const onDeliveryUpdated = (payload: {
                    messageId: string;
                    enquiryId: string;
                    deliveryStatus: string;
                }) => {
                    if (!mounted) return;
                    setThread(prev => {
                        if (!prev) return prev;
                        const updated = prev.enquiries.map(enq => ({
                            ...enq,
                            messages: enq.messages.map(m =>
                                m.id === payload.messageId
                                    ? { ...m, deliveryStatus: payload.deliveryStatus }
                                    : m
                            ),
                        }));
                        return { ...prev, enquiries: updated };
                    });
                };

                const onReactionUpdated = (payload: { messageId: string; reactions: { emoji: string; count: number }[] }) => {
                    if (!mounted) return;
                    setThread(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            enquiries: prev.enquiries.map(enq => ({
                                ...enq,
                                messages: enq.messages.map(m =>
                                    m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
                                ),
                            })),
                        };
                    });
                };

                const onMessageDeleted = (payload: { messageId: string }) => {
                    if (!mounted) return;
                    setThread(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            enquiries: prev.enquiries.map(enq => ({
                                ...enq,
                                messages: enq.messages.map(m =>
                                    m.id === payload.messageId ? { ...m, isDeleted: true } : m
                                ),
                            })),
                        };
                    });
                };

                const onMessageEdited = (payload: { messageId: string; content: string; editedAt: string }) => {
                    if (!mounted) return;
                    setThread(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            enquiries: prev.enquiries.map(enq => ({
                                ...enq,
                                messages: enq.messages.map(m =>
                                    m.id === payload.messageId ? { ...m, content: payload.content, editedAt: payload.editedAt } : m
                                ),
                            })),
                        };
                    });
                };

                const onTypingUpdate = (data: { userId: string; isTyping: boolean }) => {
                    if (!mounted) return;
                    setTypingUsers(prev => {
                        const next = new Set(prev);
                        if (data.isTyping) {
                            next.add(data.userId);
                            // Auto-clear after 4s if stop event never arrives
                            const existing = typingTimeouts.current.get(data.userId);
                            if (existing) clearTimeout(existing);
                            typingTimeouts.current.set(data.userId, setTimeout(() => {
                                setTypingUsers(p => { const n = new Set(p); n.delete(data.userId); return n; });
                            }, 4000));
                        } else {
                            next.delete(data.userId);
                            const t = typingTimeouts.current.get(data.userId);
                            if (t) { clearTimeout(t); typingTimeouts.current.delete(data.userId); }
                        }
                        return next;
                    });
                };

                sock.on('chat:new-message', onNewMessage);
                sock.on('outbound:sent', onOutboundSent);
                sock.on('outbound:delivery_updated', onDeliveryUpdated);
                sock.on('message:reaction_updated', onReactionUpdated);
                sock.on('message:deleted', onMessageDeleted);
                sock.on('message:edited', onMessageEdited);
                sock.on('typing:update', onTypingUpdate);

                offFns.push(
                    () => sock.off('chat:new-message', onNewMessage),
                    () => sock.off('outbound:sent', onOutboundSent),
                    () => sock.off('outbound:delivery_updated', onDeliveryUpdated),
                    () => sock.off('message:reaction_updated', onReactionUpdated),
                    () => sock.off('message:deleted', onMessageDeleted),
                    () => sock.off('message:edited', onMessageEdited),
                    () => sock.off('typing:update', onTypingUpdate),
                );
            } catch (err) {
                console.error('Chat WebSocket setup failed:', err);
            }
        }

        setupSocket();

        return () => {
            mounted = false;
            offFns.forEach(fn => fn());
        };
    }, [contactId]);

    // ── Join enquiry room so outbound:sent / outbound:delivery_updated are received ──
    const activeEnquiryId = thread?.enquiries[0]?.enquiryId ?? null;
    useEffect(() => {
        if (!activeEnquiryId) return;
        joinEnquiryRoom(activeEnquiryId);
        return () => { leaveEnquiryRoom(activeEnquiryId); };
    }, [activeEnquiryId]);

    // ── Auto-scroll only when message count increases (not on delivery status ticks) ──
    useEffect(() => {
        if (loading || !thread) return;
        const count = thread.enquiries.reduce((sum, enq) => sum + enq.messages.length, 0);
        if (count > prevMsgCountRef.current) {
            const el = scrollRef.current;
            const isNearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 200 : true;
            if (isNearBottom) {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                setShowScrollBtn(false);
            } else {
                setShowScrollBtn(true);
            }
        }
        prevMsgCountRef.current = count;
    }, [thread, loading]);

    if (loading) {
        return (
            <div className={styles.chatView}>
                <div className={styles.chatMessages} style={{ paddingTop: 24 }}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className={styles.skeletonRow}>
                            <div className={styles.skeletonBubble} />
                        </div>
                    ))}
                </div>
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

    const handleChannelSwitch = (channel: 'WHATSAPP' | 'EMAIL') => {
        setActiveChannel(channel);
        setUnseenChannels(prev => {
            const next = new Set(prev);
            next.delete(channel);
            return next;
        });
    };

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

            {/* ── Channel Toggle ─────────────────────────────────── */}
            <div className={styles.channelToggle}>
                <button
                    className={`${styles.channelBtn} ${activeChannel === 'WHATSAPP' ? styles.channelBtnActive : ''}`}
                    onClick={() => handleChannelSwitch('WHATSAPP')}
                >
                    💬 WhatsApp {unseenChannels.has('WHATSAPP') && <span className={styles.channelUnseenDot} />}
                </button>
                <button
                    className={`${styles.channelBtn} ${activeChannel === 'EMAIL' ? styles.channelBtnActive : ''}`}
                    onClick={() => handleChannelSwitch('EMAIL')}
                >
                    📧 Email {unseenChannels.has('EMAIL') && <span className={styles.channelUnseenDot} />}
                </button>
            </div>

            {/* ── Messages Area — all enquiry blocks ───────────── */}
            <div className={styles.chatMessagesWrapper}>
                <div
                    ref={scrollRef}
                    className={styles.chatMessages}
                    onScroll={() => {
                        const el = scrollRef.current;
                        if (!el) return;
                        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                        if (atBottom) setShowScrollBtn(false);
                    }}
                >
                    {thread.enquiries.length === 0 ? (
                        <div className={styles.chatEmpty}>No conversations yet</div>
                    ) : !thread.enquiries.some(enq => enq.messages.some(m => m.channel === activeChannel)) ? (
                        <div className={styles.chatEmpty}>No {activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} messages in this conversation</div>
                    ) : (
                        [...thread.enquiries].reverse().map((enq) => (
                            <EnquiryBlock
                                key={enq.enquiryId}
                                enq={enq}
                                newMessageIds={newMessageIds}
                                activeChannel={activeChannel}
                            />
                        ))
                    )}
                    {/* Typing indicator */}
                    {typingUsers.size > 0 && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '4px 0',
                            color: 'rgba(255,255,255,0.45)',
                            fontSize: '0.75rem',
                        }}>
                            <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                                {[0, 1, 2].map(i => (
                                    <span key={i} style={{
                                        width: '6px', height: '6px', borderRadius: '50%',
                                        background: 'rgba(99,102,241,0.7)',
                                        animation: `typingDot 1.2s infinite ${i * 0.2}s`,
                                    }} />
                                ))}
                            </span>
                            typing...
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>

                {showScrollBtn && (
                    <button
                        className={styles.newMsgFloat}
                        onClick={() => {
                            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                            setShowScrollBtn(false);
                        }}
                    >
                        ↓ New messages
                    </button>
                )}
            </div>

            {/* ── Composer ─────────────────────────────────────────── */}
            <InlineComposer
                enquiryId={activeEnquiry?.enquiryId ?? null}
                channel={activeChannel}
                contact={thread.contact}
                onMessageSent={(msg) => {
                    // Optimistically append to thread
                    setThread(prev => {
                        if (!prev || !activeEnquiry) return prev;
                        const updated = prev.enquiries.map(enq => {
                            if (enq.enquiryId !== activeEnquiry.enquiryId) return enq;
                            return {
                                ...enq,
                                messages: [...enq.messages, msg],
                                messageCount: enq.messageCount + 1,
                            };
                        });
                        return { ...prev, enquiries: updated };
                    });
                    // Scroll to bottom
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                }}
            />

        </div>
    );
}

// ── Inline Composer ────────────────────────────────────────────────

interface InlineComposerProps {
    enquiryId: string | null;
    channel: 'WHATSAPP' | 'EMAIL';
    contact: ConversationThread['contact'];
    onMessageSent: (msg: ThreadMessage) => void;
}

function InlineComposer({ enquiryId, channel, contact, onMessageSent }: InlineComposerProps) {
    const [body, setBody] = useState('');
    const [subject, setSubject] = useState('');
    const [sending, setSending] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const draftIdRef = useRef<string | null>(null);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSendingRef = useRef(false);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isTypingRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploads, addFiles, removeFile, retryFile, clearAll: clearUploads, isUploading } = useUpload(draftIdRef.current ?? null);

    // Resolve recipient for the selected channel
    const recipientChannel = contact.channels.find(c => c.channel === channel)
        ?? contact.channels.find(c => c.isPrimary)
        ?? contact.channels[0]
        ?? null;
    const to = recipientChannel?.identifier ?? null;

    const canSend = !!enquiryId && !!to && (body.trim().length > 0 || uploads.some(u => u.status === 'done')) && !sending && !isUploading;

    // Auto-save draft 3s after user stops typing.
    // Skipped when handleSend is in-flight to prevent race: both writing to same draft.
    const scheduleSave = useCallback(() => {
        if (!enquiryId || !body.trim()) return;
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(async () => {
            if (isSendingRef.current) return;
            try {
                if (draftIdRef.current) {
                    await updateDraft(draftIdRef.current, { channel, subject, body });
                } else {
                    const d = await createDraft(enquiryId, { channel, subject, body });
                    draftIdRef.current = d.id;
                }
            } catch {
                // silent — draft save failure is non-blocking
            }
        }, 3000);
    }, [enquiryId, channel, subject, body]);

    // Cleanup timer on unmount
    useEffect(() => () => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    }, []);

    const handleSend = async () => {
        if (!canSend || !enquiryId) return;
        isSendingRef.current = true;
        setSending(true);
        setError(null);
        // Cancel any pending auto-save — handleSend will manage the draft
        if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
        // Stop typing indicator
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        if (isTypingRef.current) {
            isTypingRef.current = false;
            getSocket().then(s => s.emit('typing:stop', { enquiryId })).catch(() => {});
        }
        try {
            // Ensure draft exists before sending
            if (!draftIdRef.current) {
                const d = await createDraft(enquiryId, { channel, subject, body });
                draftIdRef.current = d.id;
            } else {
                await updateDraft(draftIdRef.current, { channel, subject, body });
            }

            const sent = await sendDraft(draftIdRef.current!, to ?? undefined);
            draftIdRef.current = null;

            // Build optimistic thread message shape
            const optimisticMsg: ThreadMessage = {
                id: sent.id,
                content: sent.content,
                direction: 'OUTBOUND',
                channel: sent.channel,
                from: sent.from,
                to: sent.to ?? null,
                subject: sent.subject ?? null,
                deliveryStatus: 'PENDING',
                createdAt: sent.createdAt,
                sentByUser: sent.sentByUser ?? null,
            };
            onMessageSent(optimisticMsg);

            // Reset form
            setBody('');
            setSubject('');
            clearUploads();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Send failed. Please try again.';
            setError(msg);
        } finally {
            isSendingRef.current = false;
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && channel === 'WHATSAPP') {
            e.preventDefault();
            handleSend();
        }
        if (e.key === 'Enter' && e.ctrlKey && channel === 'EMAIL') {
            e.preventDefault();
            handleSend();
        }
    };

    const emitTyping = useCallback(async () => {
        if (channel !== 'WHATSAPP' || !enquiryId) return;
        try {
            const sock = await getSocket();
            if (!isTypingRef.current) {
                isTypingRef.current = true;
                sock.emit('typing:start', { enquiryId });
            }
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(async () => {
                isTypingRef.current = false;
                sock.emit('typing:stop', { enquiryId });
            }, 3000);
        } catch { /* silent */ }
    }, [channel, enquiryId]);

    const handlePaste = (e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length > 0) {
            e.preventDefault();
            addFiles(files);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) addFiles(files);
    };

    if (!enquiryId) {
        return (
            <div className={styles.composer}>
                <input
                    type="text"
                    className={styles.composerInput}
                    placeholder="No active enquiry"
                    disabled
                />
                <button className={styles.composerBtn} disabled>➤</button>
            </div>
        );
    }

    if (!to) {
        return (
            <div className={styles.composer}>
                <input
                    type="text"
                    className={styles.composerInput}
                    placeholder={`No ${channel} channel configured for this contact`}
                    disabled
                />
                <button className={styles.composerBtn} disabled>➤</button>
            </div>
        );
    }

    return (
        <div
            className={styles.composerWrapper}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            style={isDragOver ? { outline: '2px dashed #6366f1', outlineOffset: '-2px' } : undefined}
        >
            {error && (
                <div className={styles.composerError}>
                    ⚠️ {error}
                    <button onClick={() => setError(null)} className={styles.composerErrorDismiss}>✕</button>
                </div>
            )}
            {channel === 'EMAIL' && (
                <input
                    type="text"
                    value={subject}
                    onChange={e => { setSubject(e.target.value); scheduleSave(); }}
                    placeholder="Subject (optional)"
                    className={styles.composerSubjectInput}
                    disabled={sending}
                />
            )}

            {/* Attachment preview strip */}
            <AttachmentPreview uploads={uploads} onRemove={removeFile} onRetry={retryFile} />

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }}
            />

            <div className={styles.composer}>
                {/* Paperclip attachment button */}
                <button
                    type="button"
                    className={styles.composerIconBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    title="Attach file"
                    style={{ opacity: sending ? 0.4 : 1 }}
                >
                    📎
                </button>

                <textarea
                    value={body}
                    onChange={e => { setBody(e.target.value); scheduleSave(); emitTyping(); }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={`Message via ${channel === 'WHATSAPP' ? 'WhatsApp · Enter to send' : 'Email · Ctrl+Enter to send'}`}
                    className={styles.composerTextarea}
                    rows={1}
                    disabled={sending}
                />
                <button
                    className={styles.composerBtn}
                    disabled={!canSend}
                    onClick={handleSend}
                    title={channel === 'EMAIL' ? 'Send (Ctrl+Enter)' : 'Send (Enter)'}
                >
                    {sending ? '⏳' : isUploading ? '⬆️' : '➤'}
                </button>
            </div>
        </div>
    );
}