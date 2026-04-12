'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConversations, type ConversationPreview } from '@/services/dashboard';
import styles from '@/styles/ContactList.module.css';
import { getSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';

const CLOSED_STATUSES = ['CONVERTED', 'CLOSED_LOST'];

const CHANNEL_ICONS: Record<string, string> = {
    WHATSAPP: '💬',
    EMAIL: '📧',
    SMS: '📱',
};

interface ContactListProps {
    activeContactId: string | null;
    onSelectContact: (conv: ConversationPreview) => void;
    unreadContacts?: Record<string, number>;
    onConversationsLoaded?: (convs: ConversationPreview[]) => void;
}

export default function ContactList({
    activeContactId,
    onSelectContact,
    unreadContacts = {},
    onConversationsLoaded,
}: ContactListProps) {
    const [conversations, setConversations] = useState<ConversationPreview[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const socketRef = useRef<Socket | null>(null);

    // Fetch conversations from API
    const fetchConversations = useCallback(async (searchTerm?: string) => {
        try {
            setLoading(true);
            const result = await getConversations({ search: searchTerm });
            setConversations(result.data);
            onConversationsLoaded?.(result.data);
        } catch (error) {
            console.error('Failed to load conversations:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchConversations(search);
    }, []);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchConversations(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    // ── WebSocket: Real-time contact list updates ──
    useEffect(() => {
        let mounted = true;

        async function setupSocket() {
            try {
                const sock = await getSocket();
                if (!mounted) return;
                socketRef.current = sock;

                sock.on('contact-list:update', (data: { conversations: ConversationPreview[] }) => {
                    if (!mounted) return;
                    if (search.trim()) return; // Don't override search results
                    setConversations(data.conversations);
                });
            } catch (err) {
                console.error('WebSocket setup failed:', err);
            }
        }

        setupSocket();

        return () => {
            mounted = false;
            socketRef.current?.off('contact-list:update');
        };
    }, [search]);

    // Format relative time (WhatsApp-style)
    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffHrs = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

        if (diffHrs < 1) {
            const mins = Math.floor(diffHrs * 60);
            return mins <= 1 ? 'just now' : `${mins}m ago`;
        }
        if (diffHrs < 24) {
            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
        if (diffHrs < 168) {
            return date.toLocaleDateString('en-IN', { weekday: 'short' });
        }
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    };

    return (
        <div className={styles.contactList}>
            {/* Header */}
            <div className={styles.listHeader}>
                <h2 className={styles.listTitle}>Messages</h2>
                <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search contacts..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Contact items */}
            <div className={styles.listBody}>
                {loading && conversations.length === 0 ? (
                    <div className={styles.emptyState}>Loading conversations...</div>
                ) : conversations.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search ? 'No contacts found' : 'No conversations yet'}
                    </div>
                ) : (
                    conversations.map((conv) => {
                        const isClosed = CLOSED_STATUSES.includes(conv.enquiryStatus);
                        const unreadCount = unreadContacts[conv.contactId] || 0;
                        const isActive = activeContactId === conv.contactId;
                        const hasUnread = unreadCount > 0 && !isActive;

                        return (
                            <div
                                key={conv.contactId}
                                className={[
                                    styles.contactItem,
                                    isActive ? styles.contactActive : '',
                                    isClosed ? styles.contactClosed : '',
                                ].filter(Boolean).join(' ')}
                                onClick={() => onSelectContact(conv)}
                            >
                                {/* Avatar */}
                                <div className={styles.avatar}>
                                    {conv.contactName.charAt(0).toUpperCase()}
                                </div>

                                {/* Content */}
                                <div className={styles.contactContent}>
                                    {/* Row 1: Name + Time */}
                                    <div className={styles.contactRow}>
                                        <span className={`${styles.contactName} ${hasUnread ? styles.contactNameUnread : ''}`}>
                                            {conv.contactName}
                                        </span>
                                        {conv.lastMessage && (
                                            <span className={`${styles.contactTime} ${hasUnread ? styles.contactTimeUnread : ''}`}>
                                                {formatTime(conv.lastMessage.createdAt)}
                                            </span>
                                        )}
                                    </div>

                                    {/* Row 2: Last message preview + Unread badge */}
                                    <div className={styles.contactRow}>
                                        <span className={`${styles.contactPreview} ${hasUnread ? styles.contactPreviewUnread : ''}`}>
                                            <span className={styles.channelIcon}>
                                                {CHANNEL_ICONS[conv.channel || ''] || '💭'}
                                            </span>
                                            {conv.lastMessage?.direction === 'OUTBOUND' && (
                                                <span className={styles.outboundArrow}>↩ </span>
                                            )}
                                            {conv.lastMessage?.content || 'No messages'}
                                        </span>
                                        {/* WhatsApp-style green unread badge */}
                                        {hasUnread && (
                                            <span className={styles.unreadBadge}>
                                                {unreadCount}
                                            </span>
                                        )}
                                    </div>

                                    {/* Row 3: Status + phone */}
                                    <div className={styles.contactMeta}>
                                        <span className={styles.statusTag}>
                                            {conv.enquiryStatus.replace(/_/g, ' ')}
                                        </span>
                                        {conv.identifier && (
                                            <span className={styles.phoneNumber}>
                                                {conv.identifier}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
