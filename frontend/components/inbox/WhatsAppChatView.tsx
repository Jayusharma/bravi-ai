'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { useMessages, useConversationRow } from '@/hooks/useConversations';
import { useContactRoom, markContactRead } from '@/lib/socket';
import { Message } from '@/contracts/socketEvents';

export interface WhatsAppChatViewProps {
  contactId?: string | null;
}

export function WhatsAppChatView({ contactId }: WhatsAppChatViewProps) {
  const [messageText, setMessageText] = useState('');

  // ⚡ JOIN WEBSOCKET ROOM FOR THIS CONTACT (Subscribes client to live events)
  useContactRoom(contactId || null);

  // ⚡ 1. FETCH MESSAGES FROM BACKEND VIA TANSTACK QUERY
  const { data, isLoading, isError } = useMessages(contactId || null);

  // ⚡ 2. FLATTEN 2D PAGES ARRAY INTO A 1D MESSAGES LIST
  const messages = data?.pages.flat() || [];

  // 📖 AUTO READ-MARK — keyed off the cached sidebar row's lastMessageSeq (server truth,
  // already live-patched by applyConversationUpdate), NOT the messages array. Using the
  // messages array would fire on every fetchNextPage pagination load (messages.length
  // grows without a new message ever arriving) — this doesn't have that problem since
  // lastMessageSeq only changes when a genuinely new message lands.
  const { data: row } = useConversationRow(contactId || '', 'WHATSAPP');
  const lastMarkedSeqRef = useRef<Record<string, number>>({});

  // One shared guard, called from both effects below. Ref updated BEFORE the emit —
  // messages landing mid-flight must not fire duplicate read:mark calls.
  function tryMarkRead(id: string, currentSeq: number) {
    if (document.visibilityState !== 'visible') return;
    if (currentSeq <= (lastMarkedSeqRef.current[id] ?? 0)) return;
    lastMarkedSeqRef.current[id] = currentSeq;
    markContactRead(id).catch(console.error);
  }

  // Fires when a new message genuinely arrives while the chat is open.
  useEffect(() => {
    if (contactId && row?.lastMessageSeq !== undefined) {
      tryMarkRead(contactId, row.lastMessageSeq);
    }
  }, [contactId, row?.lastMessageSeq]);

  // Fires when the agent alt-tabs/switches back with a contact still open.
  useEffect(() => {
    function handleVisibilityChange() {
      if (contactId && row?.lastMessageSeq !== undefined) {
        tryMarkRead(contactId, row.lastMessageSeq);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [contactId, row?.lastMessageSeq]);

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      {/* ── 1. WHATSAPP CHAT HEADER ── */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-6 bg-background">
        <div className="flex items-center gap-3.5">
          <Avatar
            fallback={contactId ? 'Contact' : 'User'}
            size="md"
            className="h-10 w-10 rounded-full border border-border/40 bg-muted"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold tracking-tight text-foreground leading-none">
                {contactId ? `Contact (${contactId})` : 'Select a Conversation'}
              </h3>
              {contactId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  WhatsApp
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {contactId ? 'WhatsApp Live Chat' : 'Choose a contact from left sidebar'}
            </p>
          </div>
        </div>

        {/* Action Icon Buttons */}
        <div className="flex items-center gap-1">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Info details"
          >
            ⓘ
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Tags"
          >
            🏷️
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="More options"
          >
            ⋮
          </button>
        </div>
      </div>

      {/* ── 2. MESSAGE THREAD AREA ── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-muted/10">
        {/* End-to-End Encryption Banner */}
        <div className="mx-auto flex max-w-md items-center justify-center gap-1.5 rounded-xl bg-card border border-border/60 px-4 py-2 text-center text-[11px] text-muted-foreground shadow-2xl">
          <span>🔒</span>
          <span>Messages are end-to-end encrypted. No one outside of this chat can read or listen to them.</span>
        </div>

        {!contactId ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            Select a contact from the left sidebar to view message history.
          </div>
        ) : isLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            Loading messages from database...
          </div>
        ) : isError ? (
          <div className="flex h-48 items-center justify-center text-xs text-red-500 font-semibold">
            Failed to load messages.
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            No message history found for this contact.
          </div>
        ) : (
          /* ⚡ 3. MAP OVER REAL MESSAGES FROM DATABASE */
          messages.map((msg: Message) => {
            const isInbound = msg.direction === 'INBOUND';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isInbound ? 'items-start' : 'items-end ml-auto'} max-w-[70%]`}
              >
                <div
                  className={`rounded-2xl p-3.5 text-xs shadow-sm ${
                    isInbound
                      ? 'rounded-tl-sm bg-card border border-border/60 text-foreground'
                      : 'rounded-tr-sm bg-emerald-500/15 border border-emerald-500/30 text-foreground'
                  }`}
                >
                  <p className="leading-relaxed">{msg.body}</p>
                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      isInbound ? 'text-muted-foreground/80' : 'text-emerald-600 font-medium'
                    }`}
                  >
                    <span>{msg.createdAt ? msg.createdAt.slice(11, 16) : ''}</span>
                    {!isInbound && (
                      <span className="text-emerald-500">
                        {msg.status === 'READ' ? '✓✓' : msg.status === 'DELIVERED' ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── 3. WHATSAPP COMPOSER BAR ── */}
      <div className="border-t border-border/60 p-4 bg-background">
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-2.5 shadow-2xl">
          <button className="text-muted-foreground hover:text-foreground transition-colors text-lg" title="Emoji">
            😀
          </button>
          <button className="text-muted-foreground hover:text-foreground transition-colors text-lg" title="Attach file">
            📎
          </button>

          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />

          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white font-bold shadow-sm hover:bg-emerald-600 transition-all cursor-pointer"
            title="Send Message"
          >
            🚀
          </button>
        </div>
      </div>
    </div>
  );
}
