'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import {
    getConversationThread,
    getConversations,
    type ConversationThread,
    type EnquiryThread,
    type ThreadMessage,
    type MessageAttachment,
    type ConversationPreview,
} from '@/services/messaging/chat.service';
import { getMessages } from '@/services/enquiry/enquiry.service';
import { searchUnified } from '@/services/messaging/contact.service';
import { useSocket } from '@/contexts/SocketContext';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { ImageLightbox } from '@/components/messaging/chat/ImageLightbox';
import { Composer } from '@/components/messaging/chat/Composer';
import styles from '@/styles/ContactList.module.css';

type ChatAction =
  | { type: 'SET_THREAD'; payload: ConversationThread | null }
  | { type: 'APPEND_MESSAGE'; payload: { enquiryId: string; message: ThreadMessage } }
  | { type: 'REPLACE_TEMP_ID'; payload: { enquiryId: string; tempId: string; messageId: string; status: string } }
  | { type: 'UPDATE_MESSAGE_STATUS'; payload: { enquiryId: string; messageId: string; deliveryStatus: string } }
  | { type: 'DELETE_MESSAGE'; payload: { messageId: string } }
  | { type: 'EDIT_MESSAGE'; payload: { messageId: string; content: string; editedAt: string } }
  | { type: 'UPDATE_REACTIONS'; payload: { messageId: string; reactions: { emoji: string; count: number }[] } };

function threadReducer(state: ConversationThread | null, action: ChatAction): ConversationThread | null {
    if (!state) {
        if (action.type === 'SET_THREAD') return action.payload;
        return null;
    }

    switch (action.type) {
        case 'SET_THREAD':
            return action.payload;

        case 'APPEND_MESSAGE': {
            const { enquiryId, message } = action.payload;
            const exists = state.enquiries.some(enq => enq.enquiryId === enquiryId);
            if (!exists) return state;

            return {
                ...state,
                enquiries: state.enquiries.map(enq => {
                    if (enq.enquiryId !== enquiryId) return enq;
                    const msgExists = enq.messages.some(m => m.id === message.id || (message.tempId && m.tempId === message.tempId));
                    if (msgExists) return enq;
                    return {
                        ...enq,
                        messages: [...enq.messages, message],
                        messageCount: enq.messageCount + 1,
                    };
                }),
            };
        }

        case 'REPLACE_TEMP_ID': {
            const { enquiryId, tempId, messageId, status } = action.payload;
            return {
                ...state,
                enquiries: state.enquiries.map(enq => {
                    if (enq.enquiryId !== enquiryId) return enq;
                    return {
                        ...enq,
                        messages: enq.messages.map(m => {
                            if (m.id === tempId || m.tempId === tempId) {
                                return {
                                    ...m,
                                    id: messageId,
                                    tempId: undefined,
                                    deliveryStatus: status,
                                };
                            }
                            return m;
                        }),
                    };
                }),
            };
        }

        case 'UPDATE_MESSAGE_STATUS': {
            const { enquiryId, messageId, deliveryStatus } = action.payload;
            return {
                ...state,
                enquiries: state.enquiries.map(enq => {
                    if (enquiryId && enq.enquiryId !== enquiryId) return enq;
                    return {
                        ...enq,
                        messages: enq.messages.map(m => {
                            if (m.id === messageId || m.tempId === messageId) {
                                return { ...m, deliveryStatus };
                            }
                            return m;
                        }),
                    };
                }),
            };
        }

        case 'DELETE_MESSAGE': {
            const { messageId } = action.payload;
            return {
                ...state,
                enquiries: state.enquiries.map(enq => ({
                    ...enq,
                    messages: enq.messages.map(m => {
                        if (m.id === messageId) return { ...m, isDeleted: true };
                        return m;
                    }),
                })),
            };
        }

        case 'EDIT_MESSAGE': {
            const { messageId, content, editedAt } = action.payload;
            return {
                ...state,
                enquiries: state.enquiries.map(enq => ({
                    ...enq,
                    messages: enq.messages.map(m => {
                        if (m.id === messageId) return { ...m, content, editedAt };
                        return m;
                    }),
                })),
            };
        }

        case 'UPDATE_REACTIONS': {
            const { messageId, reactions } = action.payload;
            return {
                ...state,
                enquiries: state.enquiries.map(enq => ({
                    ...enq,
                    messages: enq.messages.map(m => {
                        if (m.id === messageId) return { ...m, reactions };
                        return m;
                    }),
                })),
            };
        }

        default:
            return state;
    }
}

interface ChatViewProps {
    contactId: string;
    contactName: string;
    highlightMessageId?: string | null;
    highlightEnquiryId?: string | null;
    highlightMessageChannel?: 'WHATSAPP' | 'EMAIL' | null;
    highlightQuery?: string | null;
    onClearHighlight?: () => void;
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

function highlightText(text: string, query: string | null | undefined): React.ReactNode {
    if (!text) return '';
    if (!query || !query.trim()) return text;

    const trimmedQuery = query.trim();
    const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, index) =>
                regex.test(part) ? (
                    <mark key={index} className={styles.textHighlight}>
                        {part}
                    </mark>
                ) : (
                    part
                )
            )}
        </>
    );
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

function EnquiryBlock({
    enq,
    newMessageIds,
    activeChannel,
    onImageClick,
    currentHighlightId,
    activeSearchQuery,
}: {
    enq: EnquiryThread;
    newMessageIds: Set<string>;
    activeChannel: 'WHATSAPP' | 'EMAIL';
    onImageClick?: (src: string, fileName: string) => void;
    currentHighlightId?: string | null;
    activeSearchQuery: string;
}) {
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
                                    <div className={styles.emailBody}>
                                        {highlightText(msg.content, activeSearchQuery)}
                                    </div>
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
                                msg.id === currentHighlightId ? styles.messageHighlight : '',
                            ].filter(Boolean).join(' ');

                            const bubbleClass = [
                                styles.msgBubble,
                                isInbound ? styles.bubbleInbound : styles.bubbleOutbound,
                                pos === 'middle' ? styles.bubbleGroupMiddle :
                                isFirst ? (isInbound ? styles.bubbleGroupFirst : styles.bubbleGroupFirst) :
                                isLast  ? (isInbound ? styles.bubbleGroupLast  : styles.bubbleGroupLast)  : '',
                            ].filter(Boolean).join(' ');

                            return (
                                <div key={msg.id} id={`msg-${msg.id}`} className={rowClass}>
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
                                                    <div className={styles.msgContent}>{highlightText(msg.content, activeSearchQuery)}</div>
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
                                                <span className={`${styles.deliveryStatus} ${msg.deliveryStatus === 'READ' ? styles.statusRead : ''}`}>
                                                    {msg.deliveryStatus === 'READ'      ? '✓✓' :
                                                     msg.deliveryStatus === 'DELIVERED' ? '✓✓' :
                                                     msg.deliveryStatus === 'SENT'      ? '✓'  :
                                                     msg.deliveryStatus === 'FAILED'    ? '❌' : '🕐'}
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

export default function ChatView({
    contactId,
    contactName,
    highlightMessageId,
    highlightEnquiryId,
    highlightMessageChannel,
    highlightQuery,
    onClearHighlight,
}: ChatViewProps) {
    const [thread, dispatch] = useReducer(threadReducer, null);
    const [loading, setLoading] = useState(true);

    interface EnquiryMessagesState {
        messages: ThreadMessage[];
        cursor: string | null;
        hasMore: boolean;
        loading: boolean;
    }
    const [enqStates, setEnqStates] = useState<Record<string, EnquiryMessagesState>>({});

    const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
    const [activeChannel, setActiveChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
    const [unseenChannels, setUnseenChannels] = useState<Set<string>>(new Set());
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [latestMsgPreview, setLatestMsgPreview] = useState<string | null>(null);
    const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
    const [lightbox, setLightbox] = useState<{ src: string; fileName: string } | null>(null);

    const [currentHighlightId, setCurrentHighlightId] = useState<string | null>(null);
    const [showSearchPanel, setShowSearchPanel] = useState(false);
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [localSearchResults, setLocalSearchResults] = useState<any[]>([]);
    const [localSearchLoading, setLocalSearchLoading] = useState(false);
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const prevMsgCountRef = useRef(0);
    const hasInitialScrolledRef = useRef(false);
    const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const beforeScrollHeightRef = useRef<number>(0);
    const beforeScrollTopRef = useRef<number>(0);
    const isPrependingRef = useRef<boolean>(false);

    // Scroll and highlight element helper
    const scrollToAndHighlight = useCallback((msgId: string) => {
        setCurrentHighlightId(msgId);
        setTimeout(() => {
            const element = document.getElementById(`msg-${msgId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }, []);

    // Load messages page-by-page until targeted message is found, then scroll and highlight
    const loadAndHighlightMessage = useCallback(async (msgId: string, enqId: string) => {
        let currentState = enqStates[enqId] || { messages: [], cursor: null, hasMore: true, loading: false };

        // If message is already loaded, scroll to it directly
        if (currentState.messages.some((m: ThreadMessage) => m.id === msgId)) {
            scrollToAndHighlight(msgId);
            return;
        }

        // Record scroll metrics before updates to prevent screen jump
        const el = scrollRef.current;
        if (el) {
            beforeScrollHeightRef.current = el.scrollHeight;
            beforeScrollTopRef.current = el.scrollTop;
            isPrependingRef.current = true;
        }

        // Loop load pages until we find the message or run out
        while (currentState.hasMore && !currentState.messages.some((m: ThreadMessage) => m.id === msgId)) {
            try {
                const res = await getMessages(enqId, { cursor: currentState.cursor || undefined, limit: 30 });
                const newMsgs = [...res.data].reverse() as ThreadMessage[];

                currentState = {
                    messages: [...newMsgs, ...currentState.messages],
                    cursor: res.cursor,
                    hasMore: res.hasMore,
                    loading: false
                };

                // Update the state so the DOM will render them
                setEnqStates(prev => ({
                    ...prev,
                    [enqId]: currentState
                }));
            } catch (err) {
                console.error('Failed to load page during local search highlight:', err);
                break;
            }
        }

        scrollToAndHighlight(msgId);
    }, [enqStates, scrollToAndHighlight]);

    // Handle global highlight requests from page.tsx props
    useEffect(() => {
        if (!highlightMessageId || !highlightEnquiryId || !thread) return;
        const enqId = highlightEnquiryId as string;
        const msgId = highlightMessageId as string;

        let cancelled = false;

        async function findAndHighlightGlobal() {
            // Set correct channel tab
            const targetChannel = highlightMessageChannel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
            if (targetChannel !== activeChannel) {
                setActiveChannel(targetChannel);
            }

            let currentState = enqStates[enqId] || { messages: [], cursor: null, hasMore: true, loading: false };

            while (currentState.hasMore && !currentState.messages.some((m: ThreadMessage) => m.id === msgId)) {
                if (cancelled) return;
                try {
                    const res = await getMessages(enqId, { cursor: currentState.cursor || undefined, limit: 30 });
                    if (cancelled) return;
                    const newMsgs = [...res.data].reverse() as ThreadMessage[];

                    currentState = {
                        messages: [...newMsgs, ...currentState.messages],
                        cursor: res.cursor,
                        hasMore: res.hasMore,
                        loading: false
                    };

                    setEnqStates(prev => ({
                        ...prev,
                        [enqId]: currentState
                    }));
                } catch (err) {
                    console.error('Error loading pages for global message highlight:', err);
                    break;
                }
            }

            if (cancelled) return;

            // Scroll to the element once rendered
            setTimeout(() => {
                if (cancelled) return;
                scrollToAndHighlight(msgId);
            }, 150);
        }

        findAndHighlightGlobal();

        return () => {
            cancelled = true;
        };
    }, [highlightMessageId, highlightEnquiryId, highlightMessageChannel, thread]);

    // Clear highlight when search is cleared
    useEffect(() => {
        if (!highlightMessageId) {
            setCurrentHighlightId(null);
        }
    }, [highlightMessageId]);

    // Clear highlight when local search query is empty
    useEffect(() => {
        if (!localSearchQuery.trim()) {
            setCurrentHighlightId(null);
        }
    }, [localSearchQuery]);

    // Debounced search for local messages
    useEffect(() => {
        if (!localSearchQuery.trim()) {
            setLocalSearchResults([]);
            setLocalSearchLoading(false);
            return;
        }

        setLocalSearchLoading(true);
        const timer = setTimeout(async () => {
            try {
                // Same API but passing contactId to scope search to messages of this contact
                const res = await searchUnified(localSearchQuery.trim(), contactId);
                setLocalSearchResults(res.messages || []);
            } catch (err) {
                console.error('Local chat search failed:', err);
            } finally {
                setLocalSearchLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [localSearchQuery, contactId]);

    // Socket comes from SocketProvider — already connected and authenticated
    const { socket, connectionStatus } = useSocket();
    const prevStatusRef = useRef<string>('connecting');

    // ── Reset local state when contact changes ──
    useEffect(() => {
        hasInitialScrolledRef.current = false;
        prevMsgCountRef.current = 0;
        setEnqStates({});
        setLatestMsgPreview(null);
    }, [contactId]);

    // ── Load older/paginated messages ──
    const loadMoreMessages = useCallback(async () => {
        if (!thread || thread.enquiries.length === 0) return;

        // Find the first enquiry from newest to oldest that has more messages or has not loaded yet
        const targetEnq = thread.enquiries.find(enq => {
            const enqState = enqStates[enq.enquiryId];
            return !enqState || enqState.hasMore;
        });

        if (!targetEnq) return;

        const enqId = targetEnq.enquiryId;
        const enqState = enqStates[enqId] || { messages: [], cursor: null, hasMore: true, loading: false };

        if (enqState.loading) return;

        // Record scroll metrics before updates to prevent screen jump
        const el = scrollRef.current;
        if (el) {
            beforeScrollHeightRef.current = el.scrollHeight;
            beforeScrollTopRef.current = el.scrollTop;
            isPrependingRef.current = true;
        }

        setEnqStates(prev => ({
            ...prev,
            [enqId]: { ...enqState, loading: true }
        }));

        try {
            const res = await getMessages(enqId, { cursor: enqState.cursor || undefined, limit: 30 });
            // Since API returns newest first (descending), we reverse to render chronologically ascending
            const newMsgs = [...res.data].reverse() as ThreadMessage[];

            setEnqStates(prev => {
                const existing = prev[enqId] || { messages: [], cursor: null, hasMore: true, loading: false };
                return {
                    ...prev,
                    [enqId]: {
                        messages: [...newMsgs, ...existing.messages],
                        cursor: res.cursor,
                        hasMore: res.hasMore,
                        loading: false
                    }
                };
            });
        } catch (err) {
            console.error('Failed to load messages:', err);
            setEnqStates(prev => ({
                ...prev,
                [enqId]: { ...enqState, loading: false }
            }));
            isPrependingRef.current = false;
        }
    }, [thread, enqStates]);

    // ── Load thread shell from API ──
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const data = await getConversationThread(contactId);
                if (!cancelled) {
                    dispatch({ type: 'SET_THREAD', payload: data });
                    
                    // Determine the default channel based on contact primary preference
                    const primaryChannel = data.contact.channels?.[0]?.channel || 'WHATSAPP';
                    if (primaryChannel === 'EMAIL' || primaryChannel === 'WHATSAPP') {
                        setActiveChannel(primaryChannel as 'WHATSAPP' | 'EMAIL');
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

    // ── Load initial messages when thread shell is ready ──
    useEffect(() => {
        if (!thread || thread.enquiries.length === 0) return;
        const activeEnq = thread.enquiries[0];
        if (!enqStates[activeEnq.enquiryId]) {
            loadMoreMessages();
        }
    }, [thread, enqStates, loadMoreMessages]);

    // ── Adjust scroll position after prepending older messages ──
    useEffect(() => {
        const el = scrollRef.current;
        if (el && isPrependingRef.current) {
            const delta = el.scrollHeight - beforeScrollHeightRef.current;
            if (delta > 0) {
                el.scrollTop = beforeScrollTopRef.current + delta;
            }
            isPrependingRef.current = false;
        }
    }, [enqStates]);

    // ── Resync thread shell on reconnect ──
    useEffect(() => {
        if (connectionStatus === 'connected' && prevStatusRef.current === 'disconnected') {
            async function resync() {
                try {
                    const data = await getConversationThread(contactId);
                    dispatch({ type: 'SET_THREAD', payload: data });
                    // Force refresh active enquiry's messages
                    if (data.enquiries.length > 0) {
                        const activeId = data.enquiries[0].enquiryId;
                        const res = await getMessages(activeId, { limit: 30 });
                        const newMsgs = [...res.data].reverse() as ThreadMessage[];
                        setEnqStates(prev => ({
                            ...prev,
                            [activeId]: {
                                messages: newMsgs,
                                cursor: res.cursor,
                                hasMore: res.hasMore,
                                loading: false
                            }
                        }));
                    }
                } catch (err) {
                    console.error('Failed to resync thread on reconnect:', err);
                } 
            }
            resync();
        }
        prevStatusRef.current = connectionStatus;
    }, [connectionStatus, contactId]);

    // ── WebSocket: real-time message events ──
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
                    direction: data.message.direction,
                    createdAt: data.message.createdAt,
                    channel: data.message.channel,
                }
            }));

            // Route new message into the correct enquiry state
            setEnqStates(prev => {
                const existing = prev[data.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                const msgExists = existing.messages.some(m => m.id === data.message.id || (data.message.tempId && m.tempId === data.message.tempId));
                if (msgExists) return prev;
                return {
                    ...prev,
                    [data.enquiryId]: {
                        ...existing,
                        messages: [...existing.messages, data.message]
                    }
                };
            });

            // If user is scrolled up, display "Jump to bottom" floating pill with preview
            const el = scrollRef.current;
            if (el) {
                const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
                if (!isNearBottom) {
                    const senderName = data.message.direction === 'INBOUND'
                        ? contactName
                        : (data.message.sentByUser?.displayName || data.message.sentByUser?.userName || 'Staff');
                    const previewText = data.message.content
                        ? (data.message.content.substring(0, 30) + (data.message.content.length > 30 ? '...' : ''))
                        : 'New attachment';
                    setLatestMsgPreview(`${senderName}: ${previewText}`);
                    setShowScrollBtn(true);
                }
            }

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

        const onOutboundSent = (payload: { messageId: string; enquiryId: string }) => {
            if (!mounted) return;
            setEnqStates(prev => {
                const existing = prev[payload.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                return {
                    ...prev,
                    [payload.enquiryId]: {
                        ...existing,
                        messages: existing.messages.map(m => {
                            if (m.id === payload.messageId || m.tempId === payload.messageId) {
                                return { ...m, deliveryStatus: 'SENT' };
                            }
                            return m;
                        })
                    }
                };
            });
        };

        const onDeliveryUpdated = (payload: {
            messageId: string;
            enquiryId: string;
            deliveryStatus: string;
        }) => {
            if (!mounted) return;
            setEnqStates(prev => {
                const existing = prev[payload.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                return {
                    ...prev,
                    [payload.enquiryId]: {
                        ...existing,
                        messages: existing.messages.map(m => {
                            if (m.id === payload.messageId || m.tempId === payload.messageId) {
                                return { ...m, deliveryStatus: payload.deliveryStatus };
                            }
                            return m;
                        })
                    }
                };
            });
        };

        const onReactionUpdated = (payload: { messageId: string; reactions: { emoji: string; count: number }[] }) => {
            if (!mounted) return;
            setEnqStates(prev => {
                const next = { ...prev };
                let found = false;
                for (const enquiryId of Object.keys(next)) {
                    const enqState = next[enquiryId];
                    const msgIndex = enqState.messages.findIndex(m => m.id === payload.messageId);
                    if (msgIndex !== -1) {
                        const updatedMsgs = [...enqState.messages];
                        updatedMsgs[msgIndex] = { ...updatedMsgs[msgIndex], reactions: payload.reactions };
                        next[enquiryId] = { ...enqState, messages: updatedMsgs };
                        found = true;
                        break;
                    }
                }
                return found ? next : prev;
            });
        };

        const onMessageDeleted = (payload: { messageId: string }) => {
            if (!mounted) return;
            setEnqStates(prev => {
                const next = { ...prev };
                let found = false;
                for (const enquiryId of Object.keys(next)) {
                    const enqState = next[enquiryId];
                    const msgIndex = enqState.messages.findIndex(m => m.id === payload.messageId);
                    if (msgIndex !== -1) {
                        const updatedMsgs = [...enqState.messages];
                        updatedMsgs[msgIndex] = { ...updatedMsgs[msgIndex], isDeleted: true };
                        next[enquiryId] = { ...enqState, messages: updatedMsgs };
                        found = true;
                        break;
                    }
                }
                return found ? next : prev;
            });
        };

        const onMessageEdited = (payload: { messageId: string; content: string; editedAt: string }) => {
            if (!mounted) return;
            setEnqStates(prev => {
                const next = { ...prev };
                let found = false;
                for (const enquiryId of Object.keys(next)) {
                    const enqState = next[enquiryId];
                    const msgIndex = enqState.messages.findIndex(m => m.id === payload.messageId);
                    if (msgIndex !== -1) {
                        const updatedMsgs = [...enqState.messages];
                        updatedMsgs[msgIndex] = { ...updatedMsgs[msgIndex], content: payload.content, editedAt: payload.editedAt };
                        next[enquiryId] = { ...enqState, messages: updatedMsgs };
                        found = true;
                        break;
                    }
                }
                return found ? next : prev;
            });
        };

        const onTypingUpdate = (data: { userId: string; userName?: string; isTyping: boolean }) => {
            if (!mounted) return;
            setTypingUsers(prev => {
                const next = new Map(prev);
                if (data.isTyping) {
                    next.set(data.userId, data.userName || 'Someone');
                    // Auto-clear after 4s if stop event never arrives
                    const existing = typingTimeouts.current.get(data.userId);
                    if (existing) clearTimeout(existing);
                    typingTimeouts.current.set(data.userId, setTimeout(() => {
                        setTypingUsers(p => { const n = new Map(p); n.delete(data.userId); return n; });
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

    // ── Auto-scroll calculation ──
    const totalMsgCount = useMemo(() => {
        return Object.values(enqStates).reduce((sum, state) => sum + (state.messages?.length || 0), 0);
    }, [enqStates]);

    useEffect(() => {
        if (loading || !thread) return;

        const el = scrollRef.current;
        if (!el) return;

        if (!hasInitialScrolledRef.current && totalMsgCount > 0) {
            // Instant scroll to bottom on initial load
            setTimeout(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            }, 50);
            hasInitialScrolledRef.current = true;
            prevMsgCountRef.current = totalMsgCount;
            setShowScrollBtn(false);
            return;
        }

        if (totalMsgCount > prevMsgCountRef.current && !isPrependingRef.current) {
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
            if (isNearBottom) {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                setShowScrollBtn(false);
            } else {
                setShowScrollBtn(true);
            }
        }
        prevMsgCountRef.current = totalMsgCount;
    }, [totalMsgCount, loading, thread]);

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

            <div className={styles.chatMainArea}>
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

                        {/* Search Chat Button */}
                        <button
                            className={`${styles.headerSearchBtn} ${showSearchPanel ? styles.headerSearchBtnActive : ''}`}
                            onClick={() => {
                                if (showSearchPanel) {
                                    setShowSearchPanel(false);
                                    setLocalSearchQuery('');
                                    setLocalSearchResults([]);
                                    setCurrentHighlightId(null);
                                    onClearHighlight?.();
                                } else {
                                    setShowSearchPanel(true);
                                }
                            }}
                            title="Search messages"
                        >
                            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                            </svg>
                        </button>

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
                            if (atBottom) {
                                setShowScrollBtn(false);
                                setLatestMsgPreview(null);
                            }

                            // Load older messages on scroll-up
                            if (el.scrollTop < 50) {
                                loadMoreMessages();
                            }
                        }}
                    >
                        {thread.enquiries.length === 0 ? (
                            <div className={styles.chatEmpty}>No conversations yet</div>
                        ) : !thread.enquiries.some(enq => (enqStates[enq.enquiryId]?.messages || []).some(m => m.channel === activeChannel)) ? (
                            <div className={styles.chatEmpty}>No {activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} messages in this conversation</div>
                        ) : (
                            [...thread.enquiries].reverse().map((enq) => (
                                <EnquiryBlock
                                    key={enq.enquiryId}
                                    enq={{
                                        ...enq,
                                        messages: enqStates[enq.enquiryId]?.messages || []
                                    }}
                                    newMessageIds={newMessageIds}
                                    activeChannel={activeChannel}
                                    onImageClick={(src, name) => setLightbox({ src, fileName: name })}
                                    currentHighlightId={currentHighlightId}
                                    activeSearchQuery={localSearchQuery || highlightQuery || ''}
                                />
                            ))
                        )}
                        {/* Typing indicator */}
                        {Array.from(typingUsers.entries()).map(([userId, userName]) => {
                            const isWhatsapp = activeChannel === 'WHATSAPP';
                            return ( 
                                <div key={userId} className={`${styles.msgRow} ${styles.msgOutbound}`}>
                                    <div className={`${styles.msgBubble} ${styles.bubbleOutbound}`} style={{ padding: '8px 12px' }}>
                                        <div className={styles.msgSenderName} style={{ marginBottom: '4px' }}>
                                            {userName}
                                        </div>
                                        <div className={styles.typingDots} style={{ height: '18px' }}>
                                            {[0, 1, 2].map(i => (
                                                <span key={i} className={styles.typingDot} style={{
                                                    background: isWhatsapp ? 'var(--wa-bubble-out-text)' : 'var(--text-secondary)',
                                                    animationDelay: `${i * 0.18}s`
                                                }} />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {showScrollBtn && (
                        <button
                            className={styles.newMsgFloat}
                            onClick={() => {
                                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                                setShowScrollBtn(false);
                                setLatestMsgPreview(null);
                            }}
                        >
                            ↓ {latestMsgPreview || 'New messages'}
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
                        if (!activeEnquiry) return;
                        
                        setEnqStates(prev => {
                            const existing = prev[activeEnquiry.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                            return {
                                ...prev,
                                [activeEnquiry.enquiryId]: {
                                    ...existing,
                                    messages: [...existing.messages, msg]
                                }
                            };
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
                    onMessageAck={(tempId, messageId) => {
                        if (!activeEnquiry) return;
                        
                        setEnqStates(prev => {
                            const existing = prev[activeEnquiry.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                            return {
                                ...prev,
                                [activeEnquiry.enquiryId]: {
                                    ...existing,
                                    messages: existing.messages.map(m => {
                                        if (m.id === tempId || m.tempId === tempId) {
                                            return { ...m, id: messageId, tempId: undefined, deliveryStatus: 'SENT' };
                                        }
                                        return m;
                                    })
                                }
                            };
                        });
                    }}
                    onMessageError={(tempId, error) => {
                        if (!activeEnquiry) return;
                        
                        setEnqStates(prev => {
                            const existing = prev[activeEnquiry.enquiryId] || { messages: [], cursor: null, hasMore: true, loading: false };
                            return {
                                ...prev,
                                [activeEnquiry.enquiryId]: {
                                    ...existing,
                                    messages: existing.messages.map(m => {
                                        if (m.id === tempId || m.tempId === tempId) {
                                            return { ...m, deliveryStatus: 'FAILED' };
                                        }
                                        return m;
                                    })
                                }
                            };
                        });
                    }}
                />
            </div>

            {/* ── Right Search Panel ───────────────────────────── */}
            {showSearchPanel && (
                <div className={styles.chatSearchPanel}>
                    <div className={styles.searchPanelHeader}>
                        <h3>Search Messages</h3>
                        <button
                            className={styles.closeSearchBtn}
                            onClick={() => {
                                setShowSearchPanel(false);
                                setLocalSearchQuery('');
                                setLocalSearchResults([]);
                                setCurrentHighlightId(null);
                                onClearHighlight?.();
                            }}
                            title="Close search"
                        >
                            ✕
                        </button>
                    </div>
                    <div className={styles.searchPanelBody}>
                        <div className={styles.searchPanelInputWrapper}>
                            <input
                                type="text"
                                className={styles.searchPanelInput}
                                placeholder="Search in this chat..."
                                value={localSearchQuery}
                                onChange={(e) => setLocalSearchQuery(e.target.value)}
                                autoFocus
                            />
                            {localSearchQuery && (
                                <button
                                    className={styles.clearSearchBtn}
                                    onClick={() => {
                                        setLocalSearchQuery('');
                                        setLocalSearchResults([]);
                                        setCurrentHighlightId(null);
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        {localSearchLoading ? (
                            <div className={styles.searchPanelLoading}>Searching...</div>
                        ) : localSearchQuery && localSearchResults.length === 0 ? (
                            <div className={styles.searchPanelEmpty}>No messages found</div>
                        ) : !localSearchQuery ? (
                            <div className={styles.searchPanelInfo}>
                                Search for messages inside this chat.
                            </div>
                        ) : (
                            <div className={styles.searchPanelResults}>
                                {localSearchResults.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`${styles.searchResultItem} ${msg.id === currentHighlightId ? styles.searchResultItemActive : ''}`}
                                        onClick={() => {
                                            const channelToSet = msg.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
                                            if (channelToSet !== activeChannel) {
                                                setActiveChannel(channelToSet);
                                            }
                                            loadAndHighlightMessage(msg.id, msg.enquiryId);
                                        }}
                                    >
                                        <div className={styles.searchResultMeta}>
                                            <span className={styles.searchResultSender}>
                                                {msg.direction === 'INBOUND' ? contactName : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff')}
                                            </span>
                                            <span className={styles.searchResultTime}>
                                                {new Date(msg.createdAt).toLocaleDateString('en-IN', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                })}
                                            </span>
                                        </div>
                                        <div className={styles.searchResultText}>{msg.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

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
