'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConversations, type ConversationPreview } from '@/services/messaging/chat.service';
import { searchUnified } from '@/services/messaging/contact.service';
import styles from '@/styles/ContactList.module.css';
import { getSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';

const CLOSED_STATUSES = ['CONVERTED', 'CLOSED_LOST'];

const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: '💬',
  EMAIL: '📧',
  SMS: '📱',
};

type ChannelTab = 'ALL' | 'WHATSAPP' | 'EMAIL';

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
  const [channelTab, setChannelTab] = useState<ChannelTab>('ALL');
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<ConversationPreview[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  // Track which channel tabs have unseen messages
  const [unseenChannels, setUnseenChannels] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);

  // Fetch conversations from API (with channel filter)
  const fetchConversations = useCallback(async (searchTerm?: string, ch?: ChannelTab) => {
    try {
      setLoading(true);
      const channel = ch && ch !== 'ALL' ? ch : undefined;
      const result = await getConversations({ search: searchTerm, channel });
      setConversations(result.data);
      onConversationsLoaded?.(result.data);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [onConversationsLoaded]);

  // Initial fetch and when channel tab changes
  useEffect(() => {
    fetchConversations(undefined, channelTab);
  }, [channelTab]);

  // Debounced search — uses /search endpoint when query is non-empty
  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchUnified(search.trim());
        // Shape search contact results into ConversationPreview for display
        const contactPreviews: ConversationPreview[] = res.contacts.map((c) => ({
          contactId: c.id,
          contactName: c.displayName,
          organization: c.organization,
          channel: c.channels[0]?.channel ?? null,
          identifier: c.channels[0]?.identifier ?? null,
          enquiryId: c.enquiries[0]?.id ?? '',
          enquiryStatus: c.enquiries[0]?.status ?? 'NEW',
          assignedTo: null,
          messageCount: 0,
          lastMessage: null,
          lastActivityAt: new Date().toISOString(),
        }));
        setSearchResults(contactPreviews);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // WebSocket: real-time contact list updates + unseen channel dots
  useEffect(() => {
    let mounted = true;

    async function setupSocket() {
      try {
        const sock = await getSocket();
        if (!mounted) return;
        socketRef.current = sock;

        function onContactListUpdate(data: { conversations: ConversationPreview[] }) {
          if (!mounted) return;
          if (searchRef.current.trim()) return; // don't override active search
          setConversations(data.conversations);
        }

        function onContactUpdated(data: { contactId: string; channel?: string }) {
          if (!mounted) return;
          // If viewing a different channel tab, mark that channel as having unseen activity
          if (data.channel && data.channel !== channelTab && channelTab !== 'ALL') {
            setUnseenChannels((prev) => new Set(prev).add(data.channel!));
          }
        }

        sock.on('contact-list:update', onContactListUpdate);
        sock.on('contact:updated', onContactUpdated);

        return () => {
          sock.off('contact-list:update', onContactListUpdate);
          sock.off('contact:updated', onContactUpdated);
        };
      } catch (err) {
        console.error('WebSocket setup failed:', err);
      }
    }

    let cleanup: (() => void) | undefined;
    setupSocket().then((fn) => { cleanup = fn; });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [channelTab]);

  // ── Real-time local draft and message synchronization ──
  useEffect(() => {
    const handleDraftUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { enquiryId, body, attachmentCount } = customEvent.detail;
      setConversations((prevConvs) =>
        prevConvs.map((c) => {
          if (c.enquiryId === enquiryId) {
            return {
              ...c,
              draft: body?.trim() || attachmentCount > 0 ? {
                body,
                attachmentCount: attachmentCount ?? 0,
                channel: c.channel ?? 'WHATSAPP',
              } : null,
            };
          }
          return c;
        })
      );
    };

    const handleLastMessageUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { contactId, content, direction, createdAt, channel } = customEvent.detail;
      setConversations((prevConvs) => {
        const updated = prevConvs.map((c) => {
          if (c.contactId === contactId) {
            return {
              ...c,
              lastMessage: {
                content: content.length > 80 ? content.substring(0, 80) + '…' : content,
                direction,
                channel,
                createdAt,
              },
              draft: null, // Clear draft preview since message was sent
            };
          }
          return c;
        });
        // Pull active contact with latest message to the top
        return [...updated].sort((a, b) => {
          const timeA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
          const timeB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
          return timeB - timeA;
        });
      });
    };

    window.addEventListener('draft-updated', handleDraftUpdate);
    window.addEventListener('last-message-updated', handleLastMessageUpdate);

    return () => {
      window.removeEventListener('draft-updated', handleDraftUpdate);
      window.removeEventListener('last-message-updated', handleLastMessageUpdate);
    };
  }, []);

  // Clear unseen dot when switching to that channel
  const handleChannelTab = (tab: ChannelTab) => {
    setChannelTab(tab);
    if (tab !== 'ALL') {
      setUnseenChannels((prev) => { const n = new Set(prev); n.delete(tab); return n; });
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffHrs = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    if (diffHrs < 1) {
      const mins = Math.floor(diffHrs * 60);
      return mins <= 1 ? 'just now' : `${mins}m ago`;
    }
    if (diffHrs < 24) return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (diffHrs < 168) return date.toLocaleDateString('en-IN', { weekday: 'short' });
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const displayList = searchResults ?? conversations;

  return (
    <div className={styles.contactList}>
      {/* Header */}
      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>Messages</h2>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search contacts or messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Channel tabs */}
      <div className={styles.channelTabs}>
        {(['ALL', 'WHATSAPP', 'EMAIL'] as ChannelTab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.channelTab} ${channelTab === tab ? styles.channelTabActive : ''} ${
              tab === 'WHATSAPP' ? styles.tabWhatsapp : tab === 'EMAIL' ? styles.tabEmail : styles.tabAll
            }`}
            onClick={() => handleChannelTab(tab)}
          >
            {tab === 'ALL' ? 'All' : tab === 'WHATSAPP' ? '💬 WhatsApp' : '📧 Email'}
            {tab !== 'ALL' && unseenChannels.has(tab) && (
              <span className={styles.channelTabDot} />
            )}
          </button>
        ))}
      </div>

      {/* Contact items */}
      <div className={styles.listBody}>
        {(loading && displayList.length === 0) || isSearching ? (
          <div className={styles.emptyState}>
            {isSearching ? 'Searching…' : 'Loading conversations…'}
          </div>
        ) : displayList.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? 'No results found' : 'No conversations yet'}
          </div>
        ) : (
          displayList.map((conv) => {
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
                <div className={styles.avatar}>
                  {conv.contactName.charAt(0).toUpperCase()}
                </div>

                <div className={styles.contactContent}>
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

                  <div className={styles.contactRow}>
                    {conv.draft && (conv.draft.body?.trim() || conv.draft.attachmentCount > 0) ? (
                      <span className={styles.contactPreview}>
                        <span className={styles.draftLabel}>Draft:</span>
                        <span className={styles.draftText}>
                          {conv.draft.body?.trim()
                            ? conv.draft.body.substring(0, 60)
                            : `${conv.draft.attachmentCount} attachment${conv.draft.attachmentCount > 1 ? 's' : ''}`}
                        </span>
                      </span>
                    ) : (
                      <span className={`${styles.contactPreview} ${hasUnread ? styles.contactPreviewUnread : ''}`}>
                        <span className={styles.channelIcon}>
                          {CHANNEL_ICONS[conv.channel || ''] || '💭'}
                        </span>
                        {conv.lastMessage?.direction === 'OUTBOUND' && (
                          <span className={styles.outboundArrow}>↩ </span>
                        )}
                        {conv.lastMessage?.content || 'No messages'}
                      </span>
                    )}
                    {hasUnread && (
                      <span className={styles.unreadBadge}>{unreadCount}</span>
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
