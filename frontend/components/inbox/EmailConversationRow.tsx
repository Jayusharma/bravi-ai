'use client';

import React from 'react';
import { Conversation } from '@/contracts/socketEvents';
import { useInboxStore } from '@/stores/inboxStore';
import { Avatar } from '@/components/ui/Avatar';

/**
 * EMAIL CONVERSATION ROW COMPONENT
 * Matches Image 2 Email Enterprise CRM Mockup design.
 */

export interface EmailConversationRowProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (contactId: string) => void;
}

export function EmailConversationRow({
  conversation,
  isActive,
  onSelect,
}: EmailConversationRowProps) {
  // Atomic selector: Subscribes ONLY to this contact's unread count
  const unreadCount = useInboxStore(
    (state) => state.unreadByContact[conversation.contactId] ?? conversation.unreadCount
  );

  return (
    <div
      data-active={isActive}
      onClick={() => onSelect(conversation.contactId)}
      className={`group relative flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-all duration-150 ${
        isActive
          ? 'bg-blue-500/12 text-foreground font-medium'
          : 'hover:bg-accent/50 text-foreground/90'
      }`}
    >
      {/* Contact Initials Avatar */}
      <div className="relative shrink-0 pt-0.5">
        <Avatar
          fallback={conversation.contactName || 'User'}
          size="md"
          className="h-10 w-10 rounded-full border border-blue-200/50 bg-blue-100 text-blue-700 font-bold text-xs"
        />
      </div>

      {/* Info Column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={`truncate text-sm font-semibold tracking-tight ${
              unreadCount > 0 ? 'text-foreground font-bold' : 'text-foreground/90'
            }`}
          >
            {conversation.contactName}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground/80">
            {conversation.lastMessageAt ? conversation.lastMessageAt.slice(11, 16) : ''}
          </span>
        </div>

        {/* Subject & Preview Text */}
        <div className="mt-0.5 space-y-0.5">
          <p
            className={`truncate text-xs ${
              unreadCount > 0 ? 'font-bold text-foreground' : 'font-semibold text-foreground/80'
            }`}
          >
            {conversation.lastMessagePreview || 'No subject'}
          </p>
        </div>

        {/* Bottom Row: Snippet & Blue Unread Count */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-muted-foreground">
            {conversation.lastMessagePreview || 'Click to view email thread'}
          </p>

          {/* Blue Unread Count Circle */}
          {unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
