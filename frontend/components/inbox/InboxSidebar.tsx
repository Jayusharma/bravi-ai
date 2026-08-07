'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Conversation, Channel } from '@/contracts/socketEvents';
import { useInboxStore } from '@/stores/inboxStore';
import { markContactRead } from '@/lib/socket';
import { useUnreadSummary } from '@/hooks/useUnreadSummary';
import { WhatsAppConversationRow } from './WhatsAppConversationRow';
import { EmailConversationRow } from './EmailConversationRow';

/**
 * INBOX SIDEBAR COMPONENT
 * Matches Image 1 (WhatsApp) & Image 2 (Email) Enterprise CRM Mockup design.
 */

export interface InboxSidebarProps {
  conversations: Conversation[];
  activeChannel: Channel;
  isLoading?: boolean;
}

export function filterConversations(
  conversations: Conversation[],
  searchQuery: string,
  channelFilter: Channel,
  subFilter: string
): Conversation[] {
  return conversations.filter((c) => {
    // 1. Channel Filter
    const matchesChannel =
      c.channels.includes(channelFilter) || c.lastMessageChannel === channelFilter;

    // 2. Sub-filter (All / Unread) — live filter over already-loaded, already-synced
    // server data (lastMessageSeq/lastReadSeq), not a stored/incremented counter.
    const matchesSubFilter =
      subFilter === 'unread' ? c.lastMessageSeq > c.lastReadSeq : true;

    // 3. Search Query Filter (Contact Name or Preview Text)
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      c.contactName.toLowerCase().includes(query) ||
      c.lastMessagePreview.toLowerCase().includes(query);

    return matchesChannel && matchesSubFilter && matchesSearch;
  });
}

export function InboxSidebar({ conversations, activeChannel, isLoading = false }: InboxSidebarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSubFilter, setActiveSubFilter] = useState<'all' | 'unread' | 'mine'>('all');

  // 🎯 ZUSTAND STATE & ACTIONS:
  const activeContactId = useInboxStore((state) => state.activeContactId);
  const setActiveContactId = useInboxStore((state) => state.setActiveContactId);

  const handleRowClick = (contactId: string) => {
    console.log(`👆 [UI Event] Selected Contact: ${contactId}`);
    setActiveContactId(contactId);
    // Badge clears itself once read:updated patches lastReadSeq onto this row —
    // no local clear here. That would reintroduce client-computed unread state.
    markContactRead(contactId).catch((err) => {
      console.error('Failed to mark contact read:', err);
    });
  };

  // Filter conversations live based on search & active channel tab from URL
  const filteredConversations = filterConversations(
    conversations,
    searchQuery,
    activeChannel,
    activeSubFilter
  );

  // Same single source of truth as SidebarClient's global nav badge — this pill shows
  // "how many contacts are unread on THIS channel," which is exactly what the global
  // summary already breaks out per channel. Not derived from `conversations` — that list
  // is paginated (30 per page), so a local count would undercount past the first page.
  const { data: unreadSummary } = useUnreadSummary();
  const totalUnreadCount = unreadSummary?.[activeChannel] ?? 0;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border bg-background">
      {/* Header & Title */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeChannel === 'WHATSAPP' ? '/whatsapp.png' : '/gmail.png'}
              alt={activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
              className="h-5 w-5 object-contain"
            />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-foreground leading-none">
              {activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
            </h2>
            <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
              {activeChannel === 'WHATSAPP' ? '+91 98765 43210' : 'Manage & respond to leads'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            ⚙️
          </button>
        </div>
      </div>

      {/* Sub-Filter Pills (All / Unread / Mine) */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/20">
        <button
          onClick={() => setActiveSubFilter('all')}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
            activeSubFilter === 'all'
              ? activeChannel === 'WHATSAPP'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
              : 'text-muted-foreground hover:bg-accent/60'
          }`}
        >
          All
          <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-foreground">
            {conversations.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubFilter('unread')}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
            activeSubFilter === 'unread'
              ? activeChannel === 'WHATSAPP'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
              : 'text-muted-foreground hover:bg-accent/60'
          }`}
        >
          Unread
          {totalUnreadCount > 0 && (
            <span className="rounded-full bg-emerald-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
              {totalUnreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="p-3 border-b border-border/40">
        <div className="relative flex items-center">
          <svg
            className="absolute left-3 h-4 w-4 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} conversations...`}
            className="h-9 w-full rounded-xl border border-border/70 bg-muted/40 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-indigo-500/50 focus:bg-background"
          />
        </div>
      </div>

      {/* Conversation List Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            Loading conversations...
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            No conversations found.
          </div>
        ) : (
          filteredConversations.map((conv) =>
            activeChannel === 'WHATSAPP' ? (
              <WhatsAppConversationRow
                key={conv.contactId}
                conversation={conv}
                isActive={activeContactId === conv.contactId}
                onSelect={handleRowClick}
              />
            ) : (
              <EmailConversationRow
                key={conv.contactId}
                conversation={conv}
                isActive={activeContactId === conv.contactId}
                onSelect={handleRowClick}
              />
            )
          )
        )}
      </div>
    </aside>
  );
}
