'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import Link from 'next/link';
import {
    getConversationThread,
    getConversations,
    toggleMessageStar,
    getStarredMessages,
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
import { DeliveryTicks } from '@/components/messaging/chat/DeliveryTicks';
import { ForwardPicker } from '@/components/messaging/chat/ForwardPicker';
import { useToast } from '@/components/ui/Toast';
import styles from '@/styles/ContactList.module.css';
import { WhatsAppIcon, EmailIcon, InstagramIcon, AllConversationsIcon } from './ContactList';

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
    onBack?: () => void;
    onToggleDetail?: () => void;
    showDetailPanel?: boolean;
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

/**
 * Hover arrow button + dropdown menu for a single message.
 * Forward and Copy are functional; Info and Select all are placeholders for now.
 */
function MessageActions({
    msg,
    isOpen,
    onToggle,
    onForward,
    onStar,
}: {
    msg: ThreadMessage;
    isOpen: boolean;
    onToggle: () => void;
    onForward: () => void;
    onStar: () => void;
}) {
    const toast = useToast();

    // Don't offer actions on deleted messages
    if (msg.isDeleted) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(msg.content ?? '');
            toast.success('Copied to clipboard');
        } catch {
            toast.error('Could not copy', 'Clipboard access was blocked');
        }
    };

    return (
        <div className={styles.msgActions} data-msg-menu-btn>
            <button
                type="button"
                className={styles.msgMenuBtn}
                aria-label="Message actions"
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {isOpen && (
                <div className={`${styles.msgActionMenu} ${msg.direction === 'INBOUND' ? styles.msgActionMenuInbound : ''}`} data-msg-menu onClick={(e) => e.stopPropagation()}>
                    <button
                        type="button"
                        className={styles.msgActionItem}
                        onClick={() => {
                            void handleCopy();
                            onToggle();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy
                    </button>
                    <button
                        type="button"
                        className={styles.msgActionItem}
                        onClick={onForward}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="13 17 18 12 13 7" />
                            <polyline points="6 17 11 12 6 7" />
                        </svg>
                        Forward
                    </button>
                    <button
                        type="button"
                        className={styles.msgActionItem}
                        onClick={() => {
                            toast.info('Pin feature is coming soon!');
                            onToggle();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="17" x2="12" y2="22" />
                            <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.5A2 2 0 0 1 15 9.26V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.26a2 2 0 0 1-.78 1.24l-2.78 3.5a2 2 0 0 0-.44 1.24Z" />
                        </svg>
                        Pin
                    </button>
                    <button
                        type="button"
                        className={styles.msgActionItem}
                        onClick={() => {
                            toast.info('Ask Meta AI is coming soon!');
                            onToggle();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
                            <path d="M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5z" strokeDasharray="2 2" />
                        </svg>
                        Ask Meta AI
                    </button>
                    <button
                        type="button"
                        className={`${styles.msgActionItem} ${msg.isStarred ? 'text-amber-500' : ''}`}
                        onClick={() => {
                            onStar();
                            onToggle();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={msg.isStarred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        {msg.isStarred ? 'Unstar' : 'Star'}
                    </button>
                    <div className={styles.msgActionDivider} />
                    <button
                        type="button"
                        className={styles.msgActionItem}
                        onClick={() => {
                            toast.info('Message selection is coming soon!');
                            onToggle();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                        Select
                    </button>
                </div>
            )}
        </div>
    );
}

function EnquiryBlock({
    enq,
    contactId,
    newMessageIds,
    activeChannel,
    onImageClick,
    currentHighlightId,
    activeSearchQuery,
    onStarMessage,
}: {
    enq: EnquiryThread;
    contactId: string;
    newMessageIds: Set<string>;
    activeChannel: 'WHATSAPP' | 'EMAIL';
    onImageClick?: (src: string, fileName: string) => void;
    currentHighlightId?: string | null;
    activeSearchQuery: string;
    onStarMessage: (messageId: string) => void;
}) {
    // Which message's action menu is open, and which message is being forwarded
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [forwardSourceId, setForwardSourceId] = useState<string | null>(null);

    // Close the open menu on any outside click
    useEffect(() => {
        if (!openMenuId) return;
        const onDown = (e: MouseEvent) => {
            const el = e.target as HTMLElement;
            if (!el.closest('[data-msg-menu]') && !el.closest('[data-msg-menu-btn]')) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [openMenuId]);
    const statusColor = STATUS_COLORS[enq.status] || '#6b7280';
    const filteredMessages = enq.messages.filter(msg => msg.channel === activeChannel);

    if (filteredMessages.length === 0) return null;

    const groups = buildMessageGroups(filteredMessages);

    return (
        <div className="flex flex-col gap-1.5">
            {/* Enquiry header */}
            <div className="flex items-center gap-4 my-5 select-none px-6">
                <div className="h-[1px] flex-1 bg-slate-100 dark:bg-zinc-800/85" />
                <span
                    className="px-3.5 py-1 rounded-full text-[10px] font-extrabold border shadow-sm uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: statusColor, borderColor: `${statusColor}30`, background: `${statusColor}12` }}
                >
                    {enq.status.replace(/_/g, ' ')}
                    {enq.assignedTo && (
                        <span className="opacity-60 font-medium">
                            · {enq.assignedTo.displayName || enq.assignedTo.userName}
                        </span>
                    )}
                    <span className="opacity-50 font-medium text-[9px]">
                        · {new Date(enq.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                        })}
                    </span>
                </span>
                <div className="h-[1px] flex-1 bg-slate-100 dark:bg-zinc-800/85" />
            </div>

            {groups.map((group, gi) => {
                const groupChannel = group.msgs[0]?.channel;
                if (groupChannel === 'EMAIL') {
                    return group.msgs.map((msg) => {
                        const isInbound = msg.direction === 'INBOUND';
                        return (
                            <div key={msg.id}>
                                {group.dateLabel && gi === 0 && (
                                    <div className="flex justify-center my-4 select-none">
                                        <span className="bg-slate-100/90 dark:bg-zinc-800/90 text-slate-500 dark:text-slate-400 text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm uppercase tracking-wider">
                                            {group.dateLabel}
                                        </span>
                                    </div>
                                )}
                                <div className={`relative mx-6 my-2 bg-white dark:bg-[#162026] border border-slate-100 dark:border-zinc-800/60 rounded-2xl p-4.5 shadow-sm transition-all ${newMessageIds.has(msg.id) ? 'ring-2 ring-blue-500/20' : ''} ${msg.isStarred ? 'border-amber-300 dark:border-amber-900/60 shadow-amber-500/5' : ''}`}>
                                    {msg.isStarred && (
                                        <div className="absolute top-4 right-10 z-10 text-amber-500">
                                            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 text-xs font-bold text-slate-600 dark:text-slate-400">
                                                {isInbound ? (msg.from?.charAt(0)?.toUpperCase() ?? 'C') : (msg.sentByUser?.displayName?.charAt(0)?.toUpperCase() ?? msg.sentByUser?.userName?.charAt(0)?.toUpperCase() ?? 'S')}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate">
                                                    {isInbound ? msg.from : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff')}
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">to {isInbound ? (msg.to || 'us') : msg.to}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
                                            {formatMsgTime(msg.createdAt)}
                                            <MessageActions
                                                msg={msg}
                                                isOpen={openMenuId === msg.id}
                                                onToggle={() => setOpenMenuId((cur) => (cur === msg.id ? null : msg.id))}
                                                onForward={() => { setForwardSourceId(msg.id); setOpenMenuId(null); }}
                                                onStar={() => onStarMessage(msg.id)}
                                            />
                                        </div>
                                    </div>
                                    {msg.subject && (
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-zinc-900/60 border border-slate-100/50 dark:border-zinc-800/40 rounded-xl px-3.5 py-2 mt-3 flex items-center gap-2">
                                            <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                            </svg>
                                            <span className="truncate">{msg.subject}</span>
                                        </div>
                                    )}
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-3.5">
                                            <MessageAttachments attachments={msg.attachments} onImageClick={onImageClick} />
                                        </div>
                                    )}
                                    <div className="text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-300 mt-3.5 whitespace-pre-wrap select-text">
                                        {highlightText(msg.content, activeSearchQuery)}
                                    </div>
                                </div>
                            </div>
                        );
                    });
                }

                // WhatsApp-style grouped bubbles
                return (
                    <div key={`group-${gi}`} className="flex flex-col gap-1 select-none">
                        {group.dateLabel && (
                            <div className="flex justify-center my-4 select-none">
                                <span className="bg-slate-100/90 dark:bg-zinc-800/90 text-slate-500 dark:text-slate-400 text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm uppercase tracking-wider">
                                    {group.dateLabel}
                                </span>
                            </div>
                        )}
                        {group.msgs.map((msg, mi) => {
                            const isInbound = msg.direction === 'INBOUND';
                            const pos = group.pos[mi];
                            const isLast = pos === 'last' || pos === 'single';
                            const isFirst = pos === 'first' || pos === 'single';

                            const rowClass = `flex w-full transition-all ${
                                isInbound ? 'justify-start items-start' : 'justify-end items-start gap-2.5'
                            } ${msg.id === currentHighlightId ? 'bg-yellow-500/10 dark:bg-yellow-500/5' : ''}`;

                            const bubbleClass = `${styles.msgBubble} ${
                                isInbound ? styles.bubbleInbound : styles.bubbleOutbound
                            }`;

                            return (
                                <div key={msg.id} id={`msg-${msg.id}`} className={rowClass}>
                                    {/* Staff avatar on the top-left of outbound messages */}
                                    {!isInbound && msg.sentByUser && (
                                        <div 
                                            className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm select-none mt-0.5" 
                                            title={msg.sentByUser.displayName || "Staff"}
                                        >
                                            {(msg.sentByUser.displayName || msg.sentByUser.userName).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                        </div>
                                    )}

                                    <div className={msg.isStarred ? `${bubbleClass} border border-amber-300 dark:border-amber-900/60 shadow-amber-500/5 relative` : `${bubbleClass} relative`}>
                                        {msg.isStarred && (
                                            <div className="absolute top-1.5 right-2 z-10 text-amber-500 select-none pointer-events-none">
                                                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                </svg>
                                            </div>
                                        )}
                                        <MessageActions
                                            msg={msg}
                                            isOpen={openMenuId === msg.id}
                                            onToggle={() => setOpenMenuId((cur) => (cur === msg.id ? null : msg.id))}
                                            onForward={() => { setForwardSourceId(msg.id); setOpenMenuId(null); }}
                                            onStar={() => onStarMessage(msg.id)}
                                        />

                                        {msg.isDeleted ? (
                                            <div className="text-xs text-slate-400 dark:text-slate-500 italic flex items-center gap-1.5 select-none">
                                                🚫 This message was deleted
                                            </div>
                                        ) : (
                                            <div className={`${styles.msgContent} select-text`}>
                                                {msg.content && (
                                                    <div>{highlightText(msg.content, activeSearchQuery)}</div>
                                                )}
                                                {msg.attachments && msg.attachments.length > 0 && (
                                                    <div className="mt-2 select-none">
                                                        <MessageAttachments attachments={msg.attachments} onImageClick={onImageClick} />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Timestamp & Ticks (floats absolutely) */}
                                        <div className={`${styles.msgFooterHover} ${styles.msgFooterVisible}`}>
                                            <span className={styles.msgTime}>{formatMsgTime(msg.createdAt)}</span>
                                            {msg.editedAt && <span className="opacity-75 font-normal text-[8px] ml-1">edited</span>}
                                            {!isInbound && (
                                                <DeliveryTicks
                                                    status={msg.deliveryStatus}
                                                    className={`${styles.deliveryStatus} ${msg.deliveryStatus === 'READ' ? styles.statusRead : ''}`}
                                                />
                                            )}
                                        </div>

                                        {/* Reactions */}
                                        {msg.reactions && msg.reactions.length > 0 && (
                                            <div className="absolute -bottom-2.5 right-3.5 flex gap-0.5 select-none z-10">
                                                {msg.reactions.map(r => (
                                                    <span key={r.emoji} className="flex items-center justify-center bg-white dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700 px-1.5 py-0.5 rounded-full text-[10px] shadow-sm leading-none font-bold">
                                                        {r.emoji} {r.count > 1 && <span className="ml-0.5 text-[9px] opacity-70">{r.count}</span>}
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

            {forwardSourceId && (
                <ForwardPicker
                    sourceMessageId={forwardSourceId}
                    excludeContactId={contactId}
                    onClose={() => setForwardSourceId(null)}
                />
            )}
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
    onBack,
    onToggleDetail,
    showDetailPanel,
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
    const [unseenCounts, setUnseenCounts] = useState<Record<'WHATSAPP' | 'EMAIL', number>>({ WHATSAPP: 0, EMAIL: 0 });
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [latestMsgPreview, setLatestMsgPreview] = useState<string | null>(null);
    const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
    const [lightbox, setLightbox] = useState<{ src: string; fileName: string } | null>(null);

    const [currentHighlightId, setCurrentHighlightId] = useState<string | null>(null);
    const [showSearchPanel, setShowSearchPanel] = useState(false);
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [localSearchResults, setLocalSearchResults] = useState<any[]>([]);
    const [localSearchLoading, setLocalSearchLoading] = useState(false);

    // Starring Messages Feature States & Callbacks
    const toast = useToast();
    const [starredPanelOpen, setStarredPanelOpen] = useState(false);
    const [starredMessages, setStarredMessages] = useState<ThreadMessage[]>([]);
    const [starredLoading, setStarredLoading] = useState(false);

    // Sync contact detail drawer with starred messages drawer and search drawer (mutually exclusive)
    useEffect(() => {
        if (showDetailPanel) {
            setStarredPanelOpen(false);
            setShowSearchPanel(false);
        }
    }, [showDetailPanel]);

    const loadStarredMessages = useCallback(async () => {
        setStarredLoading(true);
        try {
            const data = await getStarredMessages(contactId);
            setStarredMessages(data);
        } catch (err) {
            console.error('Failed to load starred messages:', err);
        } finally {
            setStarredLoading(false);
        }
    }, [contactId]);

    // Re-load starred messages when panel is opened
    useEffect(() => {
        if (starredPanelOpen) {
            loadStarredMessages();
        }
    }, [starredPanelOpen, loadStarredMessages]);

    const handleToggleStar = async (messageId: string) => {
        try {
            const updated = await toggleMessageStar(messageId);
            
            // Eagerly update local thread messages state
            setEnqStates(prev => {
                const next = { ...prev };
                let found = false;
                for (const enquiryId of Object.keys(next)) {
                    const enqState = next[enquiryId];
                    const msgIndex = enqState.messages.findIndex(m => m.id === messageId);
                    if (msgIndex !== -1) {
                        const updatedMsgs = [...enqState.messages];
                        updatedMsgs[msgIndex] = { ...updatedMsgs[msgIndex], isStarred: updated.isStarred };
                        next[enquiryId] = { ...enqState, messages: updatedMsgs };
                        found = true;
                        break;
                    }
                }
                return found ? next : prev;
            });

            // Update starred messages list if panel is open
            if (starredPanelOpen) {
                setStarredMessages(prev => {
                    if (updated.isStarred) {
                        // Find the message in enqStates to add to starredMessages list
                        let messageToAdd: ThreadMessage | null = null;
                        for (const enqState of Object.values(enqStates)) {
                            const found = enqState.messages.find(m => m.id === messageId);
                            if (found) {
                                messageToAdd = { ...found, isStarred: true };
                                break;
                            }
                        }
                        if (messageToAdd) {
                            return [messageToAdd, ...prev];
                        }
                    }
                    return prev.filter(m => m.id !== messageId);
                });
            }

            toast.success(updated.isStarred ? 'Message starred' : 'Message unstarred');
        } catch (err) {
            console.error('Failed to toggle star:', err);
            toast.error('Error', 'Failed to update message star status');
        }
    };
    
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

        // Automatically clear highlight after 2.5 seconds
        setTimeout(() => {
            setCurrentHighlightId(prev => prev === msgId ? null : prev);
        }, 2500);
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
        setUnseenCounts({ WHATSAPP: 0, EMAIL: 0 });
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
                    
                    // Determine the default channel based on new messages or contact preference
                    const defaultChannel = highlightMessageChannel || data.contact.channels?.[0]?.channel || 'WHATSAPP';
                    if (defaultChannel === 'EMAIL' || defaultChannel === 'WHATSAPP') {
                        setActiveChannel(defaultChannel as 'WHATSAPP' | 'EMAIL');
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
                    if (data.message.direction === 'INBOUND') {
                        setUnseenCounts(prev => ({
                            ...prev,
                            [data.message.channel]: (prev[data.message.channel as 'WHATSAPP' | 'EMAIL'] || 0) + 1
                        }));
                    }
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

        const onMessageStarToggled = (payload: { contactId: string; messageId: string; isStarred: boolean }) => {
            if (!mounted) return;
            if (payload.contactId !== contactId) return;

            setEnqStates(prev => {
                const next = { ...prev };
                let found = false;
                for (const enquiryId of Object.keys(next)) {
                    const enqState = next[enquiryId];
                    const msgIndex = enqState.messages.findIndex(m => m.id === payload.messageId);
                    if (msgIndex !== -1) {
                        const updatedMsgs = [...enqState.messages];
                        updatedMsgs[msgIndex] = { ...updatedMsgs[msgIndex], isStarred: payload.isStarred };
                        next[enquiryId] = { ...enqState, messages: updatedMsgs };
                        found = true;
                        break;
                    }
                }
                return found ? next : prev;
            });

            // If the starred messages drawer is currently showing the unstarred message, filter it out
            setStarredMessages(prev => prev.filter(m => m.id !== payload.messageId));
        };

        socket.on(SOCKET_EVENTS.MESSAGE_NEW, onNewMessage);
        socket.on(SOCKET_EVENTS.OUTBOUND_SENT, onOutboundSent);
        socket.on(SOCKET_EVENTS.OUTBOUND_DELIVERY_UPDATED, onDeliveryUpdated);
        socket.on(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, onReactionUpdated);
        socket.on(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
        socket.on(SOCKET_EVENTS.MESSAGE_EDITED, onMessageEdited);
        socket.on(SOCKET_EVENTS.TYPING_UPDATE, onTypingUpdate);
        socket.on(SOCKET_EVENTS.MESSAGE_STAR_TOGGLED, onMessageStarToggled);

        return () => {
            mounted = false;
            socket.off(SOCKET_EVENTS.MESSAGE_NEW, onNewMessage);
            socket.off(SOCKET_EVENTS.OUTBOUND_SENT, onOutboundSent);
            socket.off(SOCKET_EVENTS.OUTBOUND_DELIVERY_UPDATED, onDeliveryUpdated);
            socket.off(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, onReactionUpdated);
            socket.off(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
            socket.off(SOCKET_EVENTS.MESSAGE_EDITED, onMessageEdited);
            socket.off(SOCKET_EVENTS.TYPING_UPDATE, onTypingUpdate);
            socket.off(SOCKET_EVENTS.MESSAGE_STAR_TOGGLED, onMessageStarToggled);
        };
    }, [socket, contactId, starredPanelOpen]);

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
        setUnseenCounts(prev => ({ ...prev, [channel]: 0 }));
        setUnseenChannels(prev => {
            const next = new Set(prev);
            next.delete(channel);
            return next;
        });
    };

    const whatsapp = thread.contact.channels.find(c => c.channel === 'WHATSAPP')?.identifier || 'No phone';
    const email = thread.contact.channels.find(c => c.channel === 'EMAIL')?.identifier || 'No email';
    const allTags = Array.from(new Set(thread.enquiries.flatMap(e => e.tags)));

    const whatsappCount = thread.enquiries.reduce((sum, enq) => sum + (enqStates[enq.enquiryId]?.messages || []).filter(m => m.channel === 'WHATSAPP').length, 0);
    const emailCount = thread.enquiries.reduce((sum, enq) => sum + (enqStates[enq.enquiryId]?.messages || []).filter(m => m.channel === 'EMAIL').length, 0);

    return (
        <div className={`${styles.chatView} ${activeChannel === 'WHATSAPP' ? styles.channelWhatsapp : styles.channelEmail}`}>

            <div className={styles.chatMainArea}>
                {/* ── Chat Header ──────────────────────────────────── */}
                <div className="flex items-center justify-between bg-white dark:bg-[#111b21] px-6 py-4 select-none shrink-0">
                    <div className="flex items-center gap-3.5 min-w-0">
                        {/* Back Button for mobile view */}
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="md:hidden p-1 mr-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer transition-colors"
                                title="Back to inbox"
                            >
                                <svg className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                        )}

                        {/* Avatar */}
                        <div className="relative shrink-0">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 text-sm font-bold text-primary-foreground shadow-sm">
                                {thread.contact.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#111b21] bg-emerald-500" />
                        </div>

                        {/* Name & Contact Metadata */}
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate leading-tight">
                                    {thread.contact.displayName}
                                </h3>
                                {allTags.includes('High Potential') && (
                                    <span className="inline-flex rounded-lg bg-[#f3e8ff] text-[#7c3aed] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                        VIP
                                    </span>
                                )}
                            </div>

                            {/* Contact Info below name */}
                            <div className="flex flex-wrap items-center gap-3.5 text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-none font-medium">
                                {whatsapp && whatsapp !== 'No phone' && (
                                    <span className="flex items-center gap-1">
                                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                        </svg>
                                        <span className="font-mono">{whatsapp}</span>
                                    </span>
                                )}
                                {email && email !== 'No email' && (
                                    <span className="flex items-center gap-1 max-w-[140px] md:max-w-none truncate">
                                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <rect width="20" height="16" x="2" y="4" rx="2" />
                                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                        </svg>
                                        <span className="truncate">{email}</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Side actions */}
                    <div className="flex items-center gap-2">
                        {/* Search Button */}
                        <button 
                            onClick={() => {
                                setShowSearchPanel(prev => {
                                    const next = !prev;
                                    if (next) {
                                        setStarredPanelOpen(false);
                                        if (showDetailPanel && onToggleDetail) {
                                            onToggleDetail(); // close ContactDetailPanel
                                        }
                                    }
                                    return next;
                                });
                            }}
                            className={`rounded-xl border p-2 transition-all cursor-pointer shadow-sm ${
                                showSearchPanel 
                                    ? 'border-blue-100 dark:border-blue-950 bg-blue-50 dark:bg-blue-950/20 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-950/40' 
                                    : 'border-slate-100 dark:border-zinc-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                            title="Search Messages"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        </button>

                        {/* Star Button */}
                        <button 
                            onClick={() => {
                                setStarredPanelOpen(prev => {
                                    const next = !prev;
                                    if (next) {
                                        setShowSearchPanel(false);
                                        if (showDetailPanel && onToggleDetail) {
                                            onToggleDetail(); // close ContactDetailPanel
                                        }
                                    }
                                    return next;
                                });
                            }}
                            className={`rounded-xl border p-2 transition-all cursor-pointer shadow-sm ${
                                starredPanelOpen 
                                    ? 'border-amber-100 dark:border-amber-950 bg-amber-50 dark:bg-amber-950/20 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950/40' 
                                    : 'border-slate-100 dark:border-zinc-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                            title="Starred Messages"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill={starredPanelOpen ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </button>
                        
                        {/* More Button */}
                        <button className="rounded-xl border border-slate-100 dark:border-zinc-800 p-2 text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-all cursor-pointer shadow-sm">
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="12" cy="5" r="1" />
                                <circle cx="12" cy="19" r="1" />
                            </svg>
                        </button>

                        {/* View Contact Button */}
                        <button 
                            onClick={onToggleDetail}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2.5 px-4.5 rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
                        >
                            View Contact
                        </button>
                    </div>
                </div>

                {/* ── Sub-Tabs Under Header ──────────────────────────── */}
                <div className="flex gap-6 border-b border-slate-100 dark:border-zinc-800/80 px-6 bg-white dark:bg-[#111b21] shrink-0 overflow-x-auto scrollbar-none">
                    {(['WHATSAPP', 'EMAIL', 'INSTAGRAM'] as const).map((tab) => {
                        const isTabActive = activeChannel === tab;
                        const label = tab === 'WHATSAPP' ? 'WhatsApp' : tab === 'EMAIL' ? 'Email' : 'Instagram';
                        const unseenVal = tab !== 'INSTAGRAM' ? unseenCounts[tab as 'WHATSAPP' | 'EMAIL'] : 0;
                        
                        return (
                            <button
                                key={tab}
                                onClick={() => {
                                    if (tab !== 'INSTAGRAM') {
                                        handleChannelSwitch(tab as any);
                                    }
                                }}
                                className={`pb-3 text-xs font-semibold relative cursor-pointer transition-colors ${
                                    isTabActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                                } ${tab === 'INSTAGRAM' ? 'opacity-40 cursor-not-allowed' : ''}`}
                            >
                                <span className="flex items-center gap-1.5 pt-3">
                                    {tab === 'WHATSAPP' && <WhatsAppIcon className="h-4 w-4 text-emerald-500" />}
                                    {tab === 'EMAIL' && <EmailIcon className="h-4 w-4 text-red-500" />}
                                    {tab === 'INSTAGRAM' && <InstagramIcon className="h-4 w-4 text-pink-500" />}
                                    {label}
                                    {unseenVal > 0 && (
                                        <span className="bg-blue-600 dark:bg-blue-500 text-[10px] text-white font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none">
                                            {unseenVal}
                                        </span>
                                    )}
                                </span>
                                {isTabActive && (
                                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 dark:bg-blue-400 rounded-full" />
                                )}
                            </button>
                        );
                    })}
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
                            <div className={styles.chatEmpty}>No {activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} history</div>
                        ) : (
                            [...thread.enquiries].reverse().map((enq) => (
                                <EnquiryBlock
                                    key={enq.enquiryId}
                                    enq={{
                                        ...enq,
                                        messages: enqStates[enq.enquiryId]?.messages || []
                                    }}
                                    contactId={contactId}
                                    newMessageIds={newMessageIds}
                                    activeChannel={activeChannel}
                                    onImageClick={(src, name) => setLightbox({ src, fileName: name })}
                                    currentHighlightId={currentHighlightId}
                                    activeSearchQuery={localSearchQuery || highlightQuery || ''}
                                    onStarMessage={handleToggleStar}
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

            {/* ── Right-side Drawer (Search / Starred Messages) ── */}
            <div 
                className="h-full border-l border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111b21] flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-out select-none"
                style={{ 
                    width: (showSearchPanel || starredPanelOpen) ? '360px' : '0px', 
                    borderLeftWidth: (showSearchPanel || starredPanelOpen) ? '1px' : '0px'
                }}
            >
                <div className="w-[360px] h-full flex flex-col shrink-0 overflow-hidden relative">
                    {showSearchPanel && (
                        <div className="w-full h-full flex flex-col animate-in fade-in duration-200">
                            {/* Search Panel Header */}
                            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-zinc-800 shrink-0 bg-slate-50/50 dark:bg-zinc-900/30">
                                <h3 className="font-extrabold text-[15px] text-slate-800 dark:text-slate-200 tracking-tight">
                                    Search Messages
                                </h3>
                                <button
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer text-xs"
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

                            {/* Search Panel Body */}
                            <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#111b21]">
                                <div className="p-4 border-b border-slate-100 dark:border-zinc-800 shrink-0">
                                    <div className="relative flex items-center bg-slate-50 dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 rounded-xl px-3 py-2">
                                        <input
                                            type="text"
                                            className="w-full bg-transparent border-none text-[13px] text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                                            placeholder="Search in this chat..."
                                            value={localSearchQuery}
                                            onChange={(e) => setLocalSearchQuery(e.target.value)}
                                            autoFocus
                                        />
                                        {localSearchQuery && (
                                            <button
                                                className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
                                </div>

                                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 custom-scrollbar">
                                    {localSearchLoading ? (
                                        <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs font-semibold">
                                            Searching...
                                        </div>
                                    ) : localSearchQuery && localSearchResults.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs font-semibold">
                                            No messages found
                                        </div>
                                    ) : !localSearchQuery ? (
                                        <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs font-medium text-center px-6">
                                            Search for messages inside this chat.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {localSearchResults.map((msg) => (
                                                <div
                                                    key={msg.id}
                                                    className={`group relative bg-slate-50/50 dark:bg-zinc-900/40 hover:bg-slate-50 dark:hover:bg-zinc-900/60 border border-slate-100 dark:border-zinc-800/80 rounded-2xl p-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col gap-2.5 ${msg.id === currentHighlightId ? 'ring-2 ring-blue-500/20' : ''}`}
                                                    onClick={() => {
                                                        const channelToSet = msg.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
                                                        if (channelToSet !== activeChannel) {
                                                            setActiveChannel(channelToSet);
                                                        }
                                                        void loadAndHighlightMessage(msg.id, msg.enquiryId || '');
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between select-none">
                                                        <span className="font-bold text-[12px] text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                                                            {msg.direction === 'INBOUND' ? contactName : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff')}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                                            {new Date(msg.createdAt).toLocaleDateString('en-IN', {
                                                                day: '2-digit',
                                                                month: 'short',
                                                            })}
                                                        </span>
                                                    </div>
                                                    <div className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-4 break-words">{msg.content}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {starredPanelOpen && (
                        <div className="w-full h-full flex flex-col animate-in fade-in duration-200">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-zinc-800 shrink-0 bg-slate-50/50 dark:bg-zinc-900/30">
                                <div className="flex items-center gap-2">
                                    <svg className="h-4.5 w-4.5 text-amber-500 fill-amber-500" viewBox="0 0 24 24">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                    </svg>
                                    <h3 className="font-extrabold text-[15px] text-slate-800 dark:text-slate-200 tracking-tight">
                                        Starred Messages
                                    </h3>
                                </div>
                                <button
                                    onClick={() => setStarredPanelOpen(false)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                                >
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Content List */}
                            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 custom-scrollbar">
                                {starredLoading ? (
                                    <div className="h-full flex items-center justify-center flex-col text-slate-400 dark:text-slate-500 gap-2">
                                        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                        <span className="text-xs font-semibold">Loading starred messages...</span>
                                    </div>
                                ) : starredMessages.length === 0 ? (
                                    <div className="h-full flex items-center justify-center flex-col text-slate-400 dark:text-slate-500 px-6 text-center select-none py-12">
                                        <div className="h-12 w-12 rounded-full bg-slate-50 dark:bg-zinc-900 flex items-center justify-center text-[22px] mb-3 border border-slate-100 dark:border-zinc-800/50 shadow-inner">
                                            ⭐
                                        </div>
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">No Starred Messages</h4>
                                        <p className="text-[11.5px] mt-1.5 leading-relaxed max-w-[220px]">
                                            Hover over any message bubble and click the option menu to star important messages.
                                        </p>
                                    </div>
                                ) : (
                                    starredMessages.map((msg) => {
                                        const senderName = msg.direction === 'INBOUND' 
                                            ? contactName 
                                            : (msg.sentByUser?.displayName || msg.sentByUser?.userName || 'Staff');
                                        const isWhatsApp = msg.channel === 'WHATSAPP';

                                        return (
                                            <div 
                                                key={msg.id}
                                                className="group relative bg-slate-50/50 dark:bg-zinc-900/40 hover:bg-slate-50 dark:hover:bg-zinc-900/60 border border-slate-100 dark:border-zinc-800/80 rounded-2xl p-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col gap-2.5"
                                                onClick={() => {
                                                    void loadAndHighlightMessage(msg.id, msg.enquiryId || '');
                                                }}
                                            >
                                                {/* Meta row */}
                                                <div className="flex items-center justify-between select-none">
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-zinc-800 dark:to-zinc-700 text-slate-600 dark:text-zinc-300 font-bold text-[9px] flex items-center justify-center shadow-sm shrink-0">
                                                            {senderName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                                        </div>
                                                        <span className="font-bold text-[12px] text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                                                            {senderName}
                                                        </span>
                                                        {isWhatsApp ? (
                                                            <span className="text-[10px] text-emerald-500 font-extrabold flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100/30">
                                                                <WhatsAppIcon className="h-3 w-3 shrink-0" />
                                                                WA
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-indigo-500 font-extrabold flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100/30">
                                                                <EmailIcon className="h-3 w-3 shrink-0" />
                                                                Gmail
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                                            {new Date(msg.createdAt).toLocaleDateString('en-IN', {
                                                                day: '2-digit',
                                                                month: 'short',
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                hour12: true
                                                            })}
                                                        </span>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void handleToggleStar(msg.id);
                                                            }}
                                                            className="p-1 rounded-md text-slate-300 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all shrink-0 cursor-pointer"
                                                            title="Unstar message"
                                                        >
                                                            <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Body */}
                                                <div className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-4 break-words">
                                                    {msg.content}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
