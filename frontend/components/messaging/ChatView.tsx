'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    getConversationThread,
    getConversations,
    type ConversationThread,
    type EnquiryThread,
    type ThreadMessage,
    type MessageAttachment,
    type ConversationPreview,
} from '@/services/messaging/chat.service';
import { useSocket } from '@/contexts/SocketContext';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { ImageLightbox } from '@/components/messaging/chat/ImageLightbox';
import { Composer } from '@/components/messaging/chat/Composer';
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

function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_ICONS: Record<string, string> = {
    'application/pdf': '📄',
    'application/msword': '📝',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
    'application/vnd.ms-excel': '📊',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
    'text/csv': '📊',
    'text/plain': '📄',
    'application/zip': '📦',
    'application/x-rar-compressed': '📦',
};

function getDocIcon(mimeType: string): string {
    return DOC_ICONS[mimeType] ?? '📎';
}

function MessageAttachments({ attachments, onImageClick }: {
    attachments: MessageAttachment[];
    onImageClick?: (src: string, fileName: string) => void;
}) {
    if (!attachments || attachments.length === 0) return null;

    const images = attachments.filter((a) => a.kind === 'IMAGE');
    const videos = attachments.filter((a) => a.kind === 'VIDEO');
    const audios = attachments.filter((a) => a.kind === 'AUDIO' || a.kind === 'VOICE_NOTE');
    const docs = attachments.filter((a) => a.kind === 'DOCUMENT');

    return (
        <div className={styles.msgAttachments}>
            {/* Image grid */}
            {images.length > 0 && (
                <div className={images.length === 1 ? styles.msgImageSingle : styles.msgImageGrid}>
                    {images.map((img) => (
                        <button
                            key={img.id}
                            type="button"
                            className={styles.msgImageLink}
                            onClick={() => onImageClick?.(img.cdnUrl ?? '', img.fileName)}
                        >
                            <img
                                src={img.cdnUrl ?? ''}
                                alt={img.fileName}
                                className={styles.msgImageAttachment}
                                loading="lazy"
                            />
                        </button>
                    ))}
                </div>
            )}

            {/* Videos */}
            {videos.map((vid) => (
                <div key={vid.id} className={styles.msgVideoAttachment}>
                    <video
                        src={vid.cdnUrl ?? ''}
                        controls
                        preload="metadata"
                        className={styles.msgVideoPlayer}
                    />
                </div>
            ))}

            {/* Audio */}
            {audios.map((aud) => (
                <div key={aud.id} className={styles.msgAudioAttachment}>
                    <audio src={aud.cdnUrl ?? ''} controls preload="metadata" className={styles.msgAudioPlayer} />
                    <span className={styles.msgAudioName}>{aud.fileName}</span>
                </div>
            ))}

            {/* Documents — with Open + Download buttons */}
            {docs.map((doc) => (
                <div key={doc.id} className={styles.msgDocAttachment}>
                    <span className={styles.msgDocIcon}>{getDocIcon(doc.mimeType)}</span>
                    <div className={styles.msgDocInfo}>
                        <span className={styles.msgDocName}>{doc.fileName}</span>
                        <span className={styles.msgDocSize}>{fmtSize(doc.fileSize)}</span>
                    </div>
                    <div className={styles.msgDocActions}>
                        <a
                            href={doc.cdnUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.msgDocBtn}
                            onClick={(e) => e.stopPropagation()}
                        >
                            ↗ Open
                        </a>
                        <a
                            href={doc.cdnUrl ?? '#'}
                            download={doc.fileName}
                            className={styles.msgDocBtn}
                            onClick={(e) => e.stopPropagation()}
                        >
                            ↓ Download
                        </a>
                    </div>
                </div>
            ))}
        </div>
    );
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

function EnquiryBlock({ enq, newMessageIds, activeChannel, onImageClick }: { enq: EnquiryThread; newMessageIds: Set<string>; activeChannel: 'WHATSAPP' | 'EMAIL'; onImageClick?: (src: string, fileName: string) => void }) {
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
                                            <div className={styles.emailAvatar}>
                                                {isInbound ? (msg.from?.charAt(0)?.toUpperCase() ?? 'C') : (msg.sentByUser?.displayName?.charAt(0)?.toUpperCase() ?? msg.sentByUser?.userName?.charAt(0)?.toUpperCase() ?? 'S')}
                                            </div>
                                            <div className={styles.emailMeta}>
                                                <div className={styles.emailSender}>
                                                    {isInbound ? msg.from : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff')}
                                                </div>
                                                <div className={styles.emailTo}>to {isInbound ? (msg.to || 'us') : msg.to}</div>
                                            </div>
                                        </div>
                                        <div className={styles.emailTime}>{formatMsgTime(msg.createdAt)}</div>
                                    </div>
                                    {msg.subject && (
                                        <div className={styles.emailSubject}>
                                            <svg className="w-4 h-4 text-indigo-500 inline-block mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                            </svg>
                                            {msg.subject}
                                        </div>
                                    )}
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <MessageAttachments attachments={msg.attachments} onImageClick={onImageClick} />
                                    )}
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
                                            <>
                                                {msg.content && (
                                                    <div className={styles.msgContent}>{msg.content}</div>
                                                )}
                                                {msg.attachments && msg.attachments.length > 0 && (
                                                    <MessageAttachments attachments={msg.attachments} onImageClick={onImageClick} />
                                                )}
                                            </>
                                        )}

                                        {/* Timestamp: always visible, right-aligned via msgFooterHover layout + msgFooterVisible opacity override */}
                                        <div className={`${styles.msgFooterHover} ${styles.msgFooterVisible}`}>
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
    const [lightbox, setLightbox] = useState<{ src: string; fileName: string } | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const prevMsgCountRef = useRef(0);
    const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    // Socket comes from SocketProvider — already connected and authenticated
    const { socket } = useSocket();

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

    // ── WebSocket: real-time message events — socket guaranteed connected by SocketProvider ──
    useEffect(() => {
        if (!socket) return;

        let mounted = true;

        const onNewMessage = (data: {
                    contactId: string;
                    enquiryId: string;
                    message: ThreadMessage;
                }) => {
                    if (!mounted) return;
                    if (data.contactId !== contactId) return;

                    // Dispatch local event to sync contact list preview instantly!
                    window.dispatchEvent(new CustomEvent('last-message-updated', {
                        detail: {
                            contactId: data.contactId,
                            content: data.message.content,
                            direction: 'INBOUND',
                            createdAt: data.message.createdAt,
                            channel: data.message.channel,
                        }
                    }));

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

        socket.on(SOCKET_EVENTS.MESSAGE_NEW, onNewMessage);
        socket.on(SOCKET_EVENTS.OUTBOUND_SENT, onOutboundSent);
        socket.on(SOCKET_EVENTS.OUTBOUND_DELIVERY_UPDATED, onDeliveryUpdated);
        socket.on(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, onReactionUpdated);
        socket.on(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
        socket.on(SOCKET_EVENTS.MESSAGE_EDITED, onMessageEdited);
        socket.on(SOCKET_EVENTS.TYPING_UPDATE, onTypingUpdate);

        return () => {
            mounted = false;
            socket.off(SOCKET_EVENTS.MESSAGE_NEW, onNewMessage);
            socket.off(SOCKET_EVENTS.OUTBOUND_SENT, onOutboundSent);
            socket.off(SOCKET_EVENTS.OUTBOUND_DELIVERY_UPDATED, onDeliveryUpdated);
            socket.off(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, onReactionUpdated);
            socket.off(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
            socket.off(SOCKET_EVENTS.MESSAGE_EDITED, onMessageEdited);
            socket.off(SOCKET_EVENTS.TYPING_UPDATE, onTypingUpdate);
        };
    }, [socket, contactId]);

    // Parent (MessagingPage) already joins the contact room via contact:join.
    // All events (inbound messages, outbound status, typing) are scoped to contact:{contactId}.
    // No additional room join needed here.

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
        <div className={`${styles.chatView} ${activeChannel === 'WHATSAPP' ? styles.channelWhatsapp : styles.channelEmail}`}>

            {/* ── Chat Header ──────────────────────────────────── */}
            <div className={styles.chatHeader}>
                <div className={styles.chatHeaderAvatar}>
                    {thread.contact.displayName.charAt(0).toUpperCase()}
                </div>

                <div className={styles.chatHeaderInfo}>
                    <div className={styles.chatHeaderName}>
                        {thread.contact.displayName || primaryChannel?.identifier || 'Contact'}
                    </div>
                    <div className={styles.chatHeaderStatus}>
                        {typingUsers.size > 0 ? (
                            <span className={styles.statusTyping}>typing...</span>
                        ) : (
                            <span className={styles.statusOnline}>
                                <span className={styles.statusDot} /> online
                            </span>
                        )}
                    </div>
                </div>

                <div className={styles.chatHeaderRight}>
                    {/* Compact metadata tags */}
                    {activeEnquiry && (
                        <div className={styles.headerMetaTags}>
                            <span
                                className={styles.chatStatusBadge}
                                style={{
                                    background: `${statusColor}15`,
                                    color: statusColor,
                                    borderColor: `${statusColor}30`,
                                }}
                            >
                                {activeEnquiry.status.replace(/_/g, ' ')}
                            </span>
                            {activeEnquiry.assignedTo && (
                                <span className={styles.chatAssigned}>
                                    {activeEnquiry.assignedTo.displayName || activeEnquiry.assignedTo.userName}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Compact Direct Button Switcher */}
                    <div className={styles.headerToggleContainer}>
                        <button
                            className={`${styles.channelBtn} ${activeChannel === 'WHATSAPP' ? styles.channelBtnActiveWhatsapp : ''}`}
                            onClick={() => handleChannelSwitch('WHATSAPP')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0 fill-current" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}>
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.003 5.233 5.233.001 11.666.001c3.117.001 6.047 1.214 8.249 3.418 2.201 2.203 3.41 5.137 3.408 8.256-.005 6.433-5.236 11.664-11.67 11.664-1.995-.001-3.957-.509-5.7-1.474L0 24zm6.59-4.846c1.6.95 3.197 1.45 4.981 1.451 5.253 0 9.527-4.27 9.531-9.524.002-2.546-.99-4.94-2.793-6.744-1.802-1.804-4.2-2.796-6.749-2.797-5.253 0-9.53 4.272-9.534 9.527-.002 1.884.49 3.723 1.424 5.34l-.946 3.454 3.53-.926z" />
                            </svg>
                            WhatsApp
                            {unseenChannels.has('WHATSAPP') && <span className={styles.channelUnseenDot} />}
                        </button>
                        <button
                            className={`${styles.channelBtn} ${activeChannel === 'EMAIL' ? styles.channelBtnActiveEmail : ''}`}
                            onClick={() => handleChannelSwitch('EMAIL')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0 fill-none stroke-current" strokeWidth="2.5" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                            </svg>
                            Email
                            {unseenChannels.has('EMAIL') && <span className={styles.channelUnseenDot} />}
                        </button>
                    </div>

                    {/* 3-dots action button */}
                    <button className={styles.headerMoreBtn} title="More features">
                        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                        </svg>
                    </button>
                </div>
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
                                onImageClick={(src, name) => setLightbox({ src, fileName: name })}
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

            {/* ── Composer (socket send, draft auto-save, WhatsApp window detection) ── */}
            <Composer
                enquiryId={activeEnquiry?.enquiryId ?? null}
                channel={activeChannel}
                contact={thread.contact}
                onPreviewImage={(src, name) => setLightbox({ src, fileName: name })}
                onMessageSent={(msg) => {
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

                    // Dispatch local event to sync contact list preview instantly!
                    window.dispatchEvent(new CustomEvent('last-message-updated', {
                        detail: {
                            contactId,
                            content: msg.content,
                            direction: 'OUTBOUND',
                            createdAt: msg.createdAt,
                            channel: msg.channel,
                        }
                    }));

                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                }}
            />

            {/* Image lightbox */}
            {lightbox && (
                <ImageLightbox
                    src={lightbox.src}
                    fileName={lightbox.fileName}
                    onClose={() => setLightbox(null)}
                />
            )}

        </div>
    );
}
