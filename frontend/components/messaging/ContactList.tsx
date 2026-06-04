'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConversations, type ConversationPreview } from '@/services/messaging/chat.service';
import { searchUnified } from '@/services/messaging/contact.service';
import styles from '@/styles/ContactList.module.css';
import { useSocket } from '@/contexts/SocketContext';
import { SOCKET_EVENTS } from '@/lib/socket-events';

const CLOSED_STATUSES = ['CONVERTED', 'CLOSED_LOST'];

// Payload from server's conversation:updated event — single-card patch, not full list replacement
interface ConversationDelta {
  enquiryId: string;
  contactId: string;
  lastMessagePreview: string;
  lastActivityAt: string;
  status: string;
  unreadDelta: number;
  updatedField: 'NEW_INBOUND' | 'OUTBOUND_SENT' | 'MESSAGE_DELETED';
}

const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: '💬',
  EMAIL: '📧',
  SMS: '📱',
};

type ChannelTab = 'ALL' | 'WHATSAPP' | 'EMAIL';

interface ContactListProps {
  activeContactId: string | null;
  onSelectContact: (
    conv: ConversationPreview,
    messageId?: string,
    enquiryId?: string,
    messageChannel?: 'WHATSAPP' | 'EMAIL',
    searchQuery?: string
  ) => void;
  unreadContacts?: Record<string, number>;
  onConversationsLoaded?: (convs: ConversationPreview[]) => void;
}

interface UnifiedSearchResult {
  type: 'contact' | 'message';
  contactId: string;
  contactName: string;
  organization: string | null;
  channel: string | null;
  identifier: string | null;
  enquiryId: string;
  enquiryStatus: string;
  lastActivityAt: string;
  // If type === 'message'
  messageId?: string;
  messageContent?: string;
  messageTime?: string;
  messageDirection?: string;
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
  const [typingContacts, setTypingContacts] = useState<Record<string, boolean>>({});
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  // Track which channel tabs have unseen messages
  const [unseenChannels, setUnseenChannels] = useState<Set<string>>(new Set());
  // Socket + connectionStatus come from SocketProvider — no lifecycle management needed here
  const { socket, connectionStatus } = useSocket();
  // Tracks previous connectionStatus to detect reconnects and trigger a full list refetch
  const prevStatusRef = useRef<string>('connecting');
  // Debounce timer for visual re-sort — patch data instantly, re-sort once after burst settles
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Full refetch after reconnect — ensures we catch anything that arrived while disconnected
  useEffect(() => {
    if (connectionStatus === 'connected' && prevStatusRef.current === 'disconnected') {
      fetchConversations(undefined, channelTab);
    }
    prevStatusRef.current = connectionStatus;
  }, [connectionStatus, channelTab]);

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
        
        const contactResults: UnifiedSearchResult[] = res.contacts.map((c) => ({
          type: 'contact',
          contactId: c.id,
          contactName: c.displayName,
          organization: c.organization,
          channel: c.channels[0]?.channel ?? null,
          identifier: c.channels[0]?.identifier ?? null,
          enquiryId: c.enquiries[0]?.id ?? '',
          enquiryStatus: c.enquiries[0]?.status ?? 'NEW',
          lastActivityAt: new Date().toISOString(),
        }));

        const messageResults: UnifiedSearchResult[] = res.messages.map((m) => ({
          type: 'message',
          contactId: m.enquiry.contact.id,
          contactName: m.enquiry.contact.displayName,
          organization: null,
          channel: m.channel,
          identifier: null,
          enquiryId: m.enquiry.id,
          enquiryStatus: m.enquiry.status,
          lastActivityAt: m.createdAt,
          messageId: m.id,
          messageContent: m.content,
          messageTime: m.createdAt,
          messageDirection: m.direction,
        }));

        setSearchResults([...contactResults, ...messageResults]);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSelectResult = (item: UnifiedSearchResult) => {
    const existing = conversations.find((c) => c.contactId === item.contactId);
    const conv: ConversationPreview = existing || {
      contactId: item.contactId,
      contactName: item.contactName,
      organization: item.organization,
      channel: item.channel,
      identifier: item.identifier,
      enquiryId: item.enquiryId,
      enquiryStatus: item.enquiryStatus,
      assignedTo: null,
      messageCount: 0,
      lastMessage: item.messageContent ? {
        content: item.messageContent,
        direction: item.messageDirection || 'INBOUND',
        channel: item.channel || 'WHATSAPP',
        createdAt: item.messageTime || new Date().toISOString(),
      } : null,
      lastActivityAt: item.lastActivityAt,
    };

    if (item.type === 'message') {
      onSelectContact(conv, item.messageId, item.enquiryId, item.channel as 'WHATSAPP' | 'EMAIL', search.trim());
    } else {
      onSelectContact(conv);
    }
  };

  // Real-time contact list updates — socket is guaranteed connected by SocketProvider
  useEffect(() => {
    if (!socket) return;

    // Debounced re-sort: patch data immediately, delay the visual reorder to prevent burst flicker
    function scheduleReorder() {
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      reorderTimerRef.current = setTimeout(() => {
        setConversations(prev =>
          [...prev].sort((a, b) =>
            new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
          )
        );
      }, 200);
    }

    // Patch a single card in-place; schedule re-sort once; never replace the full list
    function onConversationUpdated(data: ConversationDelta) {
      if (searchRef.current.trim()) return; // don't disrupt active search results
      setConversations(prev => {
        const idx = prev.findIndex(c => c.enquiryId === data.enquiryId);
        if (idx === -1) return prev; // enquiry filtered out of current view — ignore
        return prev.map((c, i) => i !== idx ? c : {
          ...c,
          lastMessage: data.lastMessagePreview ? {
            content:   data.lastMessagePreview,
            direction: data.updatedField === 'NEW_INBOUND' ? 'INBOUND' : 'OUTBOUND',
            channel:   c.channel ?? 'WHATSAPP',
            createdAt: data.lastActivityAt,
          } : c.lastMessage,
          lastActivityAt: data.lastActivityAt,
          enquiryStatus:  data.status,
          // Clear draft preview once the message is confirmed sent by the provider
          draft: data.updatedField === 'OUTBOUND_SENT' ? null : c.draft,
        });
      });
      scheduleReorder();
    }

    // Insert a brand-new card at the top — fires only on first-ever message from a new contact
    function onConversationNew(data: ConversationPreview) {
      if (searchRef.current.trim()) return;
      setConversations(prev =>
        prev.find(c => c.enquiryId === data.enquiryId) ? prev : [data, ...prev]
      );
    }

    function onContactUpdated(data: { contactId: string; channel?: string }) {
      // Mark the other channel tab as having unseen activity
      if (data.channel && data.channel !== channelTab && channelTab !== 'ALL') {
        setUnseenChannels(prev => new Set(prev).add(data.channel!));
      }
    }

    function onConversationTyping(data: { contactId: string; isTyping: boolean }) {
      setTypingContacts(prev => ({
        ...prev,
        [data.contactId]: data.isTyping,
      }));

      if (data.isTyping) {
        if (typingTimeoutsRef.current[data.contactId]) {
          clearTimeout(typingTimeoutsRef.current[data.contactId]);
        }
        typingTimeoutsRef.current[data.contactId] = setTimeout(() => {
          setTypingContacts(prev => {
            const next = { ...prev };
            delete next[data.contactId];
            return next;
          });
        }, 4000);
      } else {
        if (typingTimeoutsRef.current[data.contactId]) {
          clearTimeout(typingTimeoutsRef.current[data.contactId]);
          delete typingTimeoutsRef.current[data.contactId];
        }
      }
    }

    socket.on(SOCKET_EVENTS.CONVERSATION_UPDATED, onConversationUpdated);
    socket.on(SOCKET_EVENTS.CONVERSATION_NEW, onConversationNew);
    socket.on(SOCKET_EVENTS.CONTACT_UPDATED, onContactUpdated);
    socket.on(SOCKET_EVENTS.CONVERSATION_TYPING, onConversationTyping);

    return () => {
      socket.off(SOCKET_EVENTS.CONVERSATION_UPDATED, onConversationUpdated);
      socket.off(SOCKET_EVENTS.CONVERSATION_NEW, onConversationNew);
      socket.off(SOCKET_EVENTS.CONTACT_UPDATED, onContactUpdated);
      socket.off(SOCKET_EVENTS.CONVERSATION_TYPING, onConversationTyping);
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
    };
  }, [socket, channelTab]);

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
        {(loading && conversations.length === 0) || isSearching ? (
          <div className={styles.emptyState}>
            {isSearching ? 'Searching…' : 'Loading conversations…'}
          </div>
        ) : search.trim() ? (
          !searchResults || searchResults.length === 0 ? (
            <div className={styles.emptyState}>No results found</div>
          ) : (
            searchResults.map((item) => {
              const isClosed = CLOSED_STATUSES.includes(item.enquiryStatus);
              const unreadCount = unreadContacts[item.contactId] || 0;
              const isActive = activeContactId === item.contactId;
              const hasUnread = unreadCount > 0 && !isActive;
              const key = item.type === 'message' ? `${item.contactId}-${item.messageId}` : item.contactId;

              return (
                <div
                  key={key}
                  className={[
                    styles.contactItem,
                    isActive ? styles.contactActive : '',
                    isClosed ? styles.contactClosed : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleSelectResult(item)}
                >
                  <div className={styles.avatar}>
                    {item.contactName.charAt(0).toUpperCase()}
                  </div>

                  <div className={styles.contactContent}>
                    <div className={styles.contactRow}>
                      <span className={`${styles.contactName} ${hasUnread ? styles.contactNameUnread : ''}`}>
                        {item.contactName}
                      </span>
                      <span className={`${styles.contactTime} ${hasUnread ? styles.contactTimeUnread : ''}`}>
                        {formatTime(item.type === 'message' ? item.messageTime! : item.lastActivityAt)}
                      </span>
                    </div>

                    <div className={styles.contactRow}>
                      {item.type === 'message' ? (
                        <span className={`${styles.contactPreview} ${hasUnread ? styles.contactPreviewUnread : ''}`}>
                          <span className={styles.channelIcon}>
                            {CHANNEL_ICONS[item.channel || ''] || '💭'}
                          </span>
                          {item.messageDirection === 'OUTBOUND' && (
                            <span className={styles.outboundArrow}>↩ </span>
                          )}
                          {item.messageContent}
                        </span>
                      ) : (
                        <span className={`${styles.contactPreview} ${hasUnread ? styles.contactPreviewUnread : ''}`}>
                          <span className={styles.channelIcon}>
                            {CHANNEL_ICONS[item.channel || ''] || '💭'}
                          </span>
                          {item.identifier || item.organization || 'No messages'}
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
          )
        ) : conversations.length === 0 ? (
          <div className={styles.emptyState}>No conversations yet</div>
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
                    {typingContacts[conv.contactId] ? (
                      <span className={`${styles.contactPreview} ${hasUnread ? styles.contactPreviewUnread : ''}`}>
                        <span className={styles.channelIcon}>
                          {CHANNEL_ICONS[conv.channel || ''] || '💭'}
                        </span>
                        <span style={{ color: 'rgba(99,102,241,0.95)', fontWeight: 500 }}>typing...</span>
                      </span>
                    ) : conv.draft && !isActive && (conv.draft.body?.trim() || conv.draft.attachmentCount > 0) ? (
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
