'use client';

import React from 'react';
import { Conversation } from '@/contracts/socketEvents';
import { useInboxStore } from '@/stores/inboxStore';
import { Avatar } from '@/components/ui/Avatar';

/**
 * ============================================================================
 * CONVERSATION ROW COMPONENT
 * Spec Ref: Section 12.1 (Row-level isolation & atomic Zustand selectors)
 * Renders a single conversation card in the inbox sidebar.
 * 
 * HARD INVARIANT:
 * - Uses fine-grained Zustand selector to subscribe ONLY to its own unread count.
 * - Powered by Channel Adapters for channel-specific preview text & icons.
 * ============================================================================
 */

export interface ConversationRowProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (contactId: string) => void;
}

/**
 * Formats ISO timestamp into human-friendly relative time string (e.g. '11:25 AM', 'Yesterday').
 */
export function formatCardTimestamp(isoString: string): string {
  // TODO: Implement relative time formatting (e.g., today -> '11:25 AM', yesterday -> 'Yesterday', older -> '04/08').
  // Spec ref: Section 12.1
  // Watch out: Must handle invalid date strings gracefully without throwing in render pass.
  throw new Error('not implemented');
}

/**
 * Resolves channel-specific preview text (Email -> subject, WhatsApp -> body text).
 */
export function getCardPreviewText(conversation: Conversation): string {
  // TODO: Delegate to ChannelAdapter.previewText or fallback to lastMessagePreview.
  // Spec ref: Section 4 & Section 12.2
  // Watch out: Ensure channel adapter is safely resolved; fallback if adapter is missing.
  throw new Error('not implemented');
}

export function ConversationRow({
  conversation,
  isActive,
  onSelect,
}: ConversationRowProps) {
  // 🎯 ATOMIC SELECTOR: Subscribe ONLY to this contact's unread count in Zustand!
  // Prevents re-rendering this card when unread count for ANOTHER contact changes.
  const unreadCount = useInboxStore(
    (state) => state.unreadByContact[conversation.contactId] ?? conversation.unreadCount
  );

  return (
    <div
      data-active={isActive}
      onClick={() => onSelect(conversation.contactId)}
      className={`group relative flex cursor-pointer items-center gap-3 rounded-2xl p-3.5 transition-all duration-200 ${
        isActive
          ? 'border border-indigo-500/20 bg-indigo-500/10 text-foreground shadow-sm'
          : 'border border-transparent hover:bg-accent/60 hover:text-foreground'
      }`}
    >
      {/* Contact Avatar */}
      <div className="relative shrink-0">
        <Avatar
          fallback={conversation.contactName || 'User'}
          size="md"
          className="bg-background"
        />
        {/* Channel Indicator Badge */}
        <span
          className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${
            conversation.lastMessageChannel === 'WHATSAPP'
              ? 'bg-emerald-500'
              : 'bg-blue-500'
          }`}
          title={conversation.lastMessageChannel}
        >
        {conversation.lastMessageChannel === 'WHATSAPP' ? 'W' : 'E'}
        </span>
      </div>

      {/* Card Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm ${
              unreadCount > 0 ? 'font-bold text-foreground' : 'font-medium text-foreground/90'
            }`}
          >
            {conversation.contactName}
          </span>
          {/* Timestamp Placeholder */}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {/* STUBBED TIMESTAMP DISPLAY */}
            {conversation.lastMessageAt ? conversation.lastMessageAt.slice(11, 16) : ''}
          </span>
        </div>

        {/* Message Preview Text */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className={`truncate text-xs ${
              unreadCount > 0 ? 'font-semibold text-foreground/80' : 'text-muted-foreground'
            }`}
          >
            {conversation.lastMessagePreview}
          </p>

          {/* Unread Counter Badge */}
          {unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
