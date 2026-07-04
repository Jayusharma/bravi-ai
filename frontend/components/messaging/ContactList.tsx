'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConversations, type ConversationPreview } from '@/services/messaging/chat.service';
import { searchUnified } from '@/services/messaging/contact.service';
import { useSocket } from '@/contexts/SocketContext';
import { SOCKET_EVENTS } from '@/lib/socket-events';

const CLOSED_STATUSES = ['CONVERTED', 'CLOSED_LOST'];

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

// Vector SVG Icons for maximum clarity and pixel-perfection
export function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.031 2c-5.516 0-9.997 4.477-9.997 9.978 0 1.942.548 3.754 1.498 5.305L2 22l4.898-1.278c1.479.805 3.167 1.258 4.963 1.258 5.516 0 9.997-4.477 9.997-9.979S17.547 2 12.031 2zm0 18.25c-1.636 0-3.17-.456-4.484-1.246l-.322-.192-2.928.764.78-2.846-.215-.34a8.217 8.217 0 0 1-1.261-4.394c0-4.542 3.702-8.239 8.23-8.239 4.529 0 8.23 3.697 8.23 8.239 0 4.541-3.701 8.239-8.23 8.239zM16.14 13.9c-.227-.113-1.341-.662-1.547-.738-.207-.076-.358-.113-.509.113-.15.227-.584.738-.716.89-.132.15-.264.17-.49.057-.227-.113-.956-.352-1.823-1.127-.674-.6-1.13-1.342-1.262-1.568-.132-.227-.014-.35.099-.462.102-.102.227-.264.34-.396.113-.132.15-.227.227-.378.076-.15.038-.283-.019-.396-.057-.113-.509-1.226-.697-1.679-.183-.446-.37-.384-.509-.391-.132-.007-.283-.007-.434-.007-.15 0-.396.057-.604.283-.207.227-.791.774-.791 1.887s.81 2.189.923 2.34c.113.15 1.594 2.434 3.862 3.415.54.234.96.374 1.288.479.542.172 1.036.148 1.426.09.434-.065 1.341-.548 1.53-.1.188-.445.188-.826.132-.902-.057-.076-.208-.113-.434-.227z"/>
    </svg>
  );
}

export function EmailIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4H18V12L12 7.5L6 12V4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H6V10L12 14.5L18 10V20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4Z" fill="#EA4335"/>
      <path d="M12 14.5L2 7.5V6L12 13L22 6V7.5L12 14.5Z" fill="#C5221F"/>
    </svg>
  );
}

export function InstagramIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function AllConversationsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
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
  const [unseenChannels, setUnseenChannels] = useState<Set<string>>(new Set());
  
  const { socket, connectionStatus } = useSocket();
  const prevStatusRef = useRef<string>('connecting');
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

  // Full refetch after reconnect
  useEffect(() => {
    if (connectionStatus === 'connected' && prevStatusRef.current === 'disconnected') {
      fetchConversations(undefined, channelTab);
    }
    prevStatusRef.current = connectionStatus;
  }, [connectionStatus, channelTab]);

  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Debounced search
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
      onSelectContact(conv, undefined, undefined, conv.lastMessage?.channel as 'WHATSAPP' | 'EMAIL' | undefined);
    }
  };

  // Real-time contact updates
  useEffect(() => {
    if (!socket) return;

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

    function onConversationUpdated(data: any) {
      if (searchRef.current.trim()) return;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.enquiryId === data.enquiryId);
        if (idx === -1) return prev;
        return prev.map((c, i) => i !== idx ? c : {
          ...c,
          lastMessage: (data.lastMessagePreview || data.updatedField === 'NEW_INBOUND' || data.updatedField === 'OUTBOUND_SENT') ? {
            content:   data.lastMessagePreview || 'Sent a message',
            direction: data.updatedField === 'NEW_INBOUND' ? 'INBOUND' : 'OUTBOUND',
            channel:   c.channel ?? 'WHATSAPP',
            createdAt: data.lastActivityAt,
          } : c.lastMessage,
          lastActivityAt: data.lastActivityAt,
          enquiryStatus:  data.status,
          draft: data.updatedField === 'OUTBOUND_SENT' ? null : c.draft,
        });
      });
      scheduleReorder();
    }

    function onConversationNew(data: ConversationPreview) {
      if (searchRef.current.trim()) return;
      setConversations(prev =>
        prev.find(c => c.enquiryId === data.enquiryId) ? prev : [data, ...prev]
      );
    }

    function onContactUpdated(data: { contactId: string; channel?: string }) {
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

    function onNotificationNewMessage(data: {
      contactId: string;
      enquiryId: string;
      messagePreview: string;
      messageId: string;
    }) {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.contactId === data.contactId);
        if (idx === -1) return prev;
        return prev.map((c, i) => i !== idx ? c : {
          ...c,
          lastMessage: {
            content: data.messagePreview || 'New message',
            direction: 'INBOUND',
            channel: c.channel ?? 'WHATSAPP',
            createdAt: new Date().toISOString(),
          },
          lastActivityAt: new Date().toISOString(),
        });
      });
      scheduleReorder();
    }

    socket.on(SOCKET_EVENTS.CONVERSATION_UPDATED, onConversationUpdated);
    socket.on(SOCKET_EVENTS.CONVERSATION_NEW, onConversationNew);
    socket.on(SOCKET_EVENTS.CONTACT_UPDATED, onContactUpdated);
    socket.on(SOCKET_EVENTS.CONVERSATION_TYPING, onConversationTyping);
    socket.on(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, onNotificationNewMessage);

    return () => {
      socket.off(SOCKET_EVENTS.CONVERSATION_UPDATED, onConversationUpdated);
      socket.off(SOCKET_EVENTS.CONVERSATION_NEW, onConversationNew);
      socket.off(SOCKET_EVENTS.CONTACT_UPDATED, onContactUpdated);
      socket.off(SOCKET_EVENTS.CONVERSATION_TYPING, onConversationTyping);
      socket.off(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, onNotificationNewMessage);
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
    };
  }, [socket, channelTab]);

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
              draft: null,
            };
          }
          return c;
        });
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
    if (diffHrs < 24) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  };

  // Sourced counts for navigation tabs
  const totalCount = conversations.length;
  const whatsappCount = conversations.filter(c => c.channel === 'WHATSAPP').length;
  const emailCount = conversations.filter(c => c.channel === 'EMAIL').length;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111b21] overflow-hidden select-none font-sans">
      {/* Header Dropdown & Filter */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 cursor-pointer group">
          <h2 className="text-[17px] font-extrabold text-slate-900 dark:text-white">All Channels</h2>
          <svg className="h-4.5 w-4.5 text-slate-500 transition-transform group-hover:translate-y-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <button className="rounded-xl p-2 border border-slate-100 dark:border-zinc-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer shadow-sm">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="21" x2="14" y1="4" y2="4" />
            <line x1="10" x2="3" y1="4" y2="4" />
            <line x1="21" x2="12" y1="12" y2="12" />
            <line x1="8" x2="3" y1="12" y2="12" />
            <line x1="21" x2="16" y1="20" y2="20" />
            <line x1="12" x2="3" y1="20" y2="20" />
            <line x1="14" x2="14" y1="2" y2="6" />
            <line x1="8" x2="8" y1="10" y2="14" />
            <line x1="12" x2="12" y1="18" y2="22" />
          </svg>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="px-5 border-b border-slate-100 dark:border-zinc-800 flex gap-4 text-xs font-semibold select-none shrink-0 overflow-x-auto scrollbar-none">
        {(['ALL', 'WHATSAPP', 'EMAIL'] as ChannelTab[]).map((tab) => {
          const isActive = channelTab === tab;
          const label = tab === 'ALL' ? 'All' : tab === 'WHATSAPP' ? 'WhatsApp' : 'Email';
          const count = tab === 'ALL' ? totalCount : tab === 'WHATSAPP' ? whatsappCount : emailCount;
          return (
            <button
              key={tab}
              onClick={() => handleChannelTab(tab)}
              className={`pb-3 relative cursor-pointer transition-colors ${
                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1">
                {label} <span className="opacity-60 font-medium text-[11px]">{count}</span>
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <svg className="absolute left-3 top-3 h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 text-xs font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Conversations List Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100/70 dark:divide-zinc-800/40 scrollbar-thin">
        {(loading && conversations.length === 0) || isSearching ? (
          <div className="flex items-center justify-center py-16 text-xs text-slate-400">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
              <span>{isSearching ? 'Searching...' : 'Loading conversations...'}</span>
            </div>
          </div>
        ) : search.trim() ? (
          !searchResults || searchResults.length === 0 ? (
            <div className="text-center py-16 text-xs text-slate-400">No results found</div>
          ) : (
            searchResults.map((item) => {
              const isClosed = CLOSED_STATUSES.includes(item.enquiryStatus);
              const unreadCount = unreadContacts[item.contactId] || 0;
              const isActive = activeContactId === item.contactId;
              const hasUnread = unreadCount > 0 && !isActive;
              const key = item.type === 'message' ? `${item.contactId}-${item.messageId}` : item.contactId;
              const initials = item.contactName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

              return (
                <div
                  key={key}
                  onClick={() => handleSelectResult(item)}
                  className={`flex items-center gap-3.5 px-5 py-4 cursor-pointer transition-all select-none ${
                    isActive ? 'bg-[#f0f4ff]/80 dark:bg-indigo-950/20' : 
                    isClosed ? 'opacity-55 hover:bg-slate-50/50 dark:hover:bg-zinc-800/30' : 
                    'hover:bg-slate-50/50 dark:hover:bg-zinc-800/30'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-850 text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-200/40">
                      {initials}
                    </div>
                    {/* Active Status Dot */}
                    <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#111b21] bg-emerald-500" />
                  </div>

                  {/* Main Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="min-w-0 flex-1">
                        <span className={`text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate block ${hasUnread ? 'text-slate-950 font-extrabold' : ''}`}>
                          {item.contactName}
                        </span>
                      </div>
                      
                      {/* Right block with fixed sizes to keep icons in a straight line */}
                      <div className="flex items-center gap-3 shrink-0">
                        {/* Channel Icon Container (Fixed width, centered, slightly bigger) */}
                        <div className="w-8 flex justify-center shrink-0">
                          {item.channel === 'EMAIL' ? (
                            <EmailIcon className="h-5.5 w-5.5" />
                          ) : item.channel === 'WHATSAPP' ? (
                            <WhatsAppIcon className="h-5.5 w-5.5 text-emerald-500" />
                          ) : (
                            <InstagramIcon className="h-5.5 w-5.5 text-pink-500" />
                          )}
                        </div>
                        {/* Time Container (Fixed width, right-aligned) */}
                        <span className="text-[11.5px] text-slate-500 font-semibold w-[60px] text-right shrink-0">
                          {formatTime(item.type === 'message' ? item.messageTime! : item.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[170px]">
                        {item.type === 'message' ? item.messageContent : (item.identifier || item.organization || 'No messages')}
                      </p>
                      {hasUnread && (
                        <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white leading-none">
                          {unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : conversations.length === 0 ? (
          <div className="text-center py-16 text-xs text-slate-400">No conversations yet</div>
        ) : (
          conversations.map((conv) => {
            const isClosed = CLOSED_STATUSES.includes(conv.enquiryStatus);
            const unreadCount = unreadContacts[conv.contactId] || 0;
            const isActive = activeContactId === conv.contactId;
            const hasUnread = unreadCount > 0 && !isActive;
            const initials = conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            const timeVal = conv.lastMessage ? formatTime(conv.lastMessage.createdAt) : formatTime(conv.lastActivityAt);
            const previewText = typingContacts[conv.contactId] ? 'typing...' :
                                conv.draft && !isActive ? `Draft: ${conv.draft.body?.trim() || 'attachments'}` :
                                conv.lastMessage ? (conv.lastMessage.content || 'Sent a message') : 'No messages';

            return (
              <div
                key={conv.contactId}
                onClick={() => onSelectContact(conv, undefined, undefined, conv.lastMessage?.channel as 'WHATSAPP' | 'EMAIL' | undefined)}
                className={`flex items-center gap-3.5 px-5 py-4 cursor-pointer transition-all select-none ${
                  isActive ? 'bg-[#f0f4ff]/80 dark:bg-indigo-950/20' : 
                  isClosed ? 'opacity-55 hover:bg-slate-50/50 dark:hover:bg-zinc-800/30' : 
                  'hover:bg-slate-50/50 dark:hover:bg-zinc-800/30'
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-850 text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-200/40">
                    {initials}
                  </div>
                  {/* Status Indicator Dot */}
                  <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#111b21] bg-emerald-500" />
                </div>

                {/* Main Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between w-full gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={`text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate block ${hasUnread ? 'text-slate-950 font-extrabold' : ''}`}>
                        {conv.contactName}
                      </span>
                    </div>
                    
                    {/* Right block with fixed sizes to keep icons in a straight line */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Channel Icon Container (Fixed width, centered, slightly bigger) */}
                      <div className="w-8 flex justify-center shrink-0">
                        {conv.channel === 'EMAIL' ? (
                          <EmailIcon className="h-5.5 w-5.5" />
                        ) : conv.channel === 'WHATSAPP' ? (
                          <WhatsAppIcon className="h-5.5 w-5.5 text-emerald-500" />
                        ) : (
                          <InstagramIcon className="h-5.5 w-5.5 text-pink-500" />
                        )}
                      </div>
                      {/* Time Container (Fixed width, right-aligned) */}
                      <span className="text-[11.5px] text-slate-500 font-semibold w-[60px] text-right shrink-0">
                        {timeVal}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-xs truncate max-w-[170px] ${
                      typingContacts[conv.contactId] ? 'text-blue-600 font-semibold' :
                      conv.draft && !isActive ? 'text-amber-600 font-medium' :
                      'text-slate-500 dark:text-slate-400'
                    }`}>
                      {previewText}
                    </p>
                    {hasUnread && (
                      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white leading-none">
                        {unreadCount}
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
