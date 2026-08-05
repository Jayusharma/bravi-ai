'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { InboxSidebar } from '@/components/inbox/InboxSidebar';
import { useInboxStore } from '@/stores/inboxStore';
import { useConversations } from '@/hooks/useConversations';
import { Channel } from '@/contracts/socketEvents';

export default function ChannelInboxPage() {
  const params = useParams();
  const rawChannel = typeof params?.channel === 'string' ? params.channel.toUpperCase() : 'WHATSAPP';
  const activeChannel: Channel = rawChannel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
  
  const activeContactId = useInboxStore((state) => state.activeContactId);

  // ⚡ REAL BACKEND DATA: Connects NestJS GET /conversations?channel=... to TanStack Query Cache!
  const { data: conversations = [], isLoading } = useConversations(activeChannel);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left Sidebar List */}
      <InboxSidebar conversations={conversations} activeChannel={activeChannel} isLoading={isLoading} />

      {/* Center Chat View Placeholder */}
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-background/20">
        {activeContactId ? (
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">
              {rawChannel} Conversation Selected
            </h3>
            <p className="text-xs text-muted-foreground">
              Active Contact ID: <code className="rounded bg-accent/70 px-2 py-0.5 font-mono">{activeContactId}</code>
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
              {rawChannel === 'WHATSAPP' ? '💬' : '✉️'}
            </div>
            <h3 className="text-base font-semibold text-foreground">
              Select a {rawChannel} conversation
            </h3>
            <p className="text-xs text-muted-foreground">
              Choose a contact from the left sidebar to view message history.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
