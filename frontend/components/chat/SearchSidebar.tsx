'use client';

// SearchSidebar — slide-in panel (same style as MembersSidebar) with a debounced
// keyword search. Clicking a result scrolls the main chat to that message.

import { useEffect, useRef, useState } from 'react';
import { searchChatMessages, type ChatMessage } from '@/services/chat/chat.service';
import { highlightKeyword } from './highlight';
import styles from '@/styles/TeamChat.module.css';

interface SearchSidebarProps {
  roomId: string;
  currentUserId: string | null;
  onSelect: (messageId: string, term: string) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 300;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SearchSidebar({ roomId, currentUserId, onSelect, onClose }: SearchSidebarProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search as the user types.
  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchChatMessages(roomId, q);
        if (active) setResults(res.messages);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [term, roomId]);

  const trimmed = term.trim();

  return (
    <>
      <div className={styles.membersBackdrop} onClick={onClose} />
      <aside className={styles.membersDrawer} role="dialog" aria-label="Search messages">
        <div className={styles.membersHeader}>
          <p className={styles.membersTitle}>Search</p>
          <button className={styles.membersClose} onClick={onClose} aria-label="Close search">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.searchBox}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search messages…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {term && (
            <button className={styles.searchClear} onClick={() => setTerm('')} aria-label="Clear">
              ✕
            </button>
          )}
        </div>

        <div className={styles.memberList}>
          {!trimmed ? (
            <div className={styles.membersNote}>Type a keyword to search this chat.</div>
          ) : loading ? (
            <div className={styles.membersNote}>Searching…</div>
          ) : results.length === 0 ? (
            <div className={styles.membersNote}>No messages found.</div>
          ) : (
            results.map((m) => {
              const name = m.senderId === currentUserId ? 'You' : (m.sender.displayName || m.sender.userName);
              return (
                <button
                  key={m.id}
                  className={styles.searchResult}
                  onClick={() => onSelect(m.id, trimmed)}
                >
                  <div className={styles.searchResultTop}>
                    <span className={styles.searchResultName}>{name}</span>
                    <span className={styles.searchResultTime}>{formatTime(m.createdAt)}</span>
                  </div>
                  <span className={styles.searchResultSnippet}>
                    {highlightKeyword(m.content ?? '', trimmed, styles.highlight)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
