'use client';

// TeamChatRoom — the single org-wide internal chat room.
// Now loads the real room + message history from the backend.
// Sending / real-time delivery still land in later steps (composer stays local).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { getChatRoom, getChatMessages, type ChatRoom, type ChatMessage } from '@/services/chat/chat.service';
import { useAuthStore } from '@/stores/auth-store';
import styles from '@/styles/TeamChat.module.css';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TeamChatRoom() {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Load room + first page of history on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const r = await getChatRoom();
        if (!active) return;
        setRoom(r);
        const history = await getChatMessages(r.id);
        if (!active) return;
        setMessages(history.messages);
      } catch {
        if (active) setError('Could not load the chat. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Keep the view pinned to the newest message after messages render.
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  return (
    <div className={styles.room}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerAvatar}>TC</div>
        <div className={styles.headerInfo}>
          <p className={styles.headerTitle}>{room?.name ?? 'Team Chat'}</p>
          <p className={styles.headerSubtitle}>
            <span className={styles.presenceDot} />
            {room ? `${room.memberCount} member${room.memberCount === 1 ? '' : 's'}` : 'Internal · everyone'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.headerIconBtn} title="Search" aria-label="Search messages">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button className={styles.headerIconBtn} title="Members" aria-label="View members">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Message list ── */}
      <div className={styles.messageList} ref={listRef}>
        {loading ? (
          <div className={styles.stateNote}>Loading messages…</div>
        ) : error ? (
          <div className={styles.stateNote}>{error}</div>
        ) : messages.length === 0 ? (
          <div className={styles.stateNote}>No messages yet. Say hello 👋</div>
        ) : (
          messages.map((msg) => {
            const mine = msg.senderId === currentUserId;
            const senderName = msg.sender.displayName || msg.sender.userName;
            return (
              <div
                key={msg.id}
                className={`${styles.row} ${mine ? styles.rowMine : styles.rowTheirs}`}
              >
                <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs}`}>
                  {!mine && <div className={styles.senderName}>{senderName}</div>}
                  <span>{msg.isDeleted ? 'This message was deleted' : msg.content}</span>
                  <span className={styles.bubbleTime}>{formatTime(msg.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Composer ── */}
      <ChatComposer />
    </div>
  );
}
