'use client';

// TeamChatRoom — the single org-wide internal chat room.
// Now loads the real room + message history from the backend.
// Sending / real-time delivery still land in later steps (composer stays local).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import {
  getChatRoom,
  getChatMessages,
  getChatMessagesAround,
  sendChatMessage,
  pinChatMessage,
  starChatMessage,
  editChatMessage,
  deleteChatMessage,
  getPinnedMessages,
  type ChatRoom,
  type ChatMessage,
  type ChatReceipts,
} from '@/services/chat/chat.service';
import { useAuthStore } from '@/stores/auth-store';
import { getSocket, joinChatRoom, leaveChatRoom } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { DeliveryTicks } from '@/components/messaging/chat/DeliveryTicks';
import { MembersSidebar } from './MembersSidebar';
import { SearchSidebar } from './SearchSidebar';
import { highlightKeyword } from './highlight';
import styles from '@/styles/TeamChat.module.css';

const EMPTY_RECEIPTS: ChatReceipts = { deliveredUpTo: null, readUpTo: null };

/** Maps a message's client state + room receipts to a WhatsApp-style tick status. */
function tickStatus(msg: ChatMessage, receipts: ChatReceipts): string {
  if (msg.failed) return 'FAILED';
  if (msg.pending) return 'PENDING';
  const sent = new Date(msg.createdAt).getTime();
  if (receipts.readUpTo && sent <= new Date(receipts.readUpTo).getTime()) return 'READ';
  if (receipts.deliveredUpTo && sent <= new Date(receipts.deliveredUpTo).getTime()) return 'DELIVERED';
  return 'SENT';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TeamChatRoom() {
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ?? null;

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ChatReceipts>(EMPTY_RECEIPTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [activePinnedIndex, setActivePinnedIndex] = useState<number>(0);
  const [deleteTargetMessage, setDeleteTargetMessage] = useState<ChatMessage | null>(null);

  // Pagination / anchored-window state for jumping to old messages.
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isAnchored, setIsAnchored] = useState(false); // viewing a historical window, not the live tail

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const isAnchoredRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const pendingPrependHeightRef = useRef<number | null>(null);

  // Mirror isAnchored into a ref so the socket callback reads the latest value.
  useEffect(() => { isAnchoredRef.current = isAnchored; }, [isAnchored]);

  // Fetch pinned messages
  const fetchPinned = useCallback(async () => {
    if (!room) return;
    try {
      const pinned = await getPinnedMessages(room.id);
      setPinnedMessages(pinned);
    } catch (err) {
      console.error('Failed to load pinned messages:', err);
    }
  }, [room]);

  useEffect(() => {
    if (room) {
      fetchPinned();
    }
  }, [room, fetchPinned]);

  // Close context menu on outside click
  useEffect(() => {
    function handleGlobalClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest(`.${styles.bubbleArrow}`) ||
        target.closest(`.${styles.contextMenu}`)
      ) {
        return;
      }
      setActiveMenuId(null);
    }
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

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
        setReceipts(r.receipts ?? EMPTY_RECEIPTS);
        const history = await getChatMessages(r.id);
        if (!active) return;
        setMessages(history.messages);
        setOlderCursor(history.nextCursor);
        setHasMoreOlder(history.hasMore);
        setIsAnchored(false);
      } catch {
        if (active) setError('Could not load the chat. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // ── Real-time: join the room, stream messages, and exchange read/delivery receipts ──
  useEffect(() => {
    if (!room) return;
    const roomId = room.id;
    let cancelled = false;
    let socketRef: Awaited<ReturnType<typeof getSocket>> | null = null;

    const emit = (event: string) => {
      socketRef?.emit(event, { conversationId: roomId });
    };

    // Being in the room = looking at the chat (we only join while on /chat),
    // so anything received here is immediately read. The delivered (gray ✓✓)
    // state becomes relevant later when the room is joined globally for unread badges.
    const markRead = () => emit(SOCKET_EVENTS.CHAT_READ);

    const onNewMessage = (data: { conversationId: string; message: ChatMessage }) => {
      if (data.conversationId !== roomId) return;
      // The sender already has this message via the optimistic flow — skip own.
      if (data.message.senderId === currentUserId) return;
      // While viewing a historical window, don't append to the tail (would create
      // a gap). The message shows up when the user jumps back to the latest.
      if (!isAnchoredRef.current) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
        );
      }
      markRead();
    };

    const onReceipts = (data: { conversationId: string } & ChatReceipts) => {
      if (data.conversationId !== roomId) return;
      setReceipts({ deliveredUpTo: data.deliveredUpTo, readUpTo: data.readUpTo });
    };

    const onMessagePinned = (data: { conversationId: string; messageId: string; isPinned: boolean }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m))
      );
      if (data.isPinned) {
        fetchPinned();
      } else {
        setPinnedMessages((prev) => prev.filter((p) => p.id !== data.messageId));
        setActivePinnedIndex(0);
      }
    };

    const onMessageStarred = (data: { conversationId: string; messageId: string; isStarred: boolean }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, isStarred: data.isStarred } : m))
      );
    };

    const onMessageEdited = (data: { conversationId: string; messageId: string; content: string; editedAt: string }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, content: data.content, editedAt: data.editedAt } : m))
      );
      setPinnedMessages((prev) =>
        prev.map((p) => (p.id === data.messageId ? { ...p, content: data.content, editedAt: data.editedAt } : p))
      );
    };

    const onMessageDeleted = (data: { conversationId: string; messageId: string; isDeleted: boolean }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, isDeleted: true, content: 'This message was deleted' } : m))
      );
      setPinnedMessages((prev) => prev.filter((p) => p.id !== data.messageId));
      setActivePinnedIndex(0);
    };

    joinChatRoom(roomId);
    getSocket().then((sock) => {
      if (cancelled) return;
      socketRef = sock;
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_NEW, onNewMessage);
      sock.on(SOCKET_EVENTS.CHAT_RECEIPTS, onReceipts);
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, onMessagePinned);
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_STARRED, onMessageStarred);
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_EDITED, onMessageEdited);
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, onMessageDeleted);
      markRead(); // opening the room reads everything currently in it
    });

    return () => {
      cancelled = true;
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_NEW, onNewMessage);
      socketRef?.off(SOCKET_EVENTS.CHAT_RECEIPTS, onReceipts);
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, onMessagePinned);
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_STARRED, onMessageStarred);
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_EDITED, onMessageEdited);
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, onMessageDeleted);
      leaveChatRoom(roomId);
    };
  }, [room, currentUserId, fetchPinned]);

  // Pin to newest. Only auto-scroll when the user is already at the bottom,
  // so incoming messages don't yank them away while they're reading history.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // After prepending older messages, keep the viewport anchored on the same
  // message by offsetting scrollTop by the height that was added on top.
  useLayoutEffect(() => {
    if (pendingPrependHeightRef.current !== null) {
      const el = listRef.current;
      if (el) el.scrollTop += el.scrollHeight - pendingPrependHeightRef.current;
      pendingPrependHeightRef.current = null;
    }
  }, [messages]);

  // Load the previous (older) page and prepend it, preserving scroll position.
  const loadOlder = useCallback(async () => {
    const el = listRef.current;
    if (!el || !room || loadingOlderRef.current || !hasMoreOlder || !olderCursor) return;
    loadingOlderRef.current = true;
    pendingPrependHeightRef.current = el.scrollHeight;
    try {
      const res = await getChatMessages(room.id, { cursor: olderCursor });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = res.messages.filter((m) => !seen.has(m.id));
        return [...fresh, ...prev];
      });
      setOlderCursor(res.nextCursor);
      setHasMoreOlder(res.hasMore);
    } catch {
      pendingPrependHeightRef.current = null;
    } finally {
      loadingOlderRef.current = false;
    }
  }, [room, hasMoreOlder, olderCursor]);

  // Track scroll position → drives the "scroll to newest" button, auto-scroll,
  // and lazy-loading of older history near the top.
  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 120;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
    if (el.scrollTop < 80) loadOlder();
  }, [loadOlder]);

  // Down-arrow: when viewing a historical window, reload the live tail; otherwise
  // just scroll to the bottom.
  const scrollToNewest = useCallback(async () => {
    if (isAnchored && room) {
      try {
        const history = await getChatMessages(room.id);
        setMessages(history.messages);
        setOlderCursor(history.nextCursor);
        setHasMoreOlder(history.hasMore);
        setIsAnchored(false);
      } catch {
        return;
      }
    }
    isAtBottomRef.current = true;
    setShowScrollDown(false);
    requestAnimationFrame(() => scrollToBottom(true));
  }, [isAnchored, room, scrollToBottom]);

  // Jump to a searched message and highlight its matched keyword. If the message
  // isn't loaded, fetch a context window around it first.
  const handleSelectSearchResult = useCallback(
    async (messageId: string, term: string) => {
      setHighlightMessageId(messageId);
      setHighlightTerm(term);

      const existing = document.getElementById(`teamchat-msg-${messageId}`);
      if (existing) {
        existing.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (!room) return;

      try {
        const res = await getChatMessagesAround(room.id, messageId);
        setMessages(res.messages);
        setOlderCursor(res.messages[0]?.id ?? null);
        setHasMoreOlder(res.hasMoreOlder);
        setIsAnchored(res.hasMoreNewer);
        isAtBottomRef.current = false;
        // Wait for the window to render, then center the target message.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            document
              .getElementById(`teamchat-msg-${messageId}`)
              ?.scrollIntoView({ block: 'center', behavior: 'auto' });
          }),
        );
      } catch {
        /* message no longer exists */
      }
    },
    [room],
  );

  // Closing search clears the highlight but leaves the scroll position put.
  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setHighlightMessageId(null);
    setHighlightTerm(null);
  }, []);

  // Optimistic send: show the message immediately, then reconcile with the server.
  const handleSend = useCallback(
    async (content: string) => {
      if (!room || !currentUser) return;

      if (editingMessage) {
        const msgId = editingMessage.id;
        setEditingMessage(null); // Clear editing state immediately
        try {
          const updated = await editChatMessage(room.id, msgId, content);
          // Update message locally in case socket takes time
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? updated : m))
          );
          setPinnedMessages((prev) =>
            prev.map((p) => (p.id === msgId ? updated : p))
          );
        } catch (err) {
          console.error('Failed to edit message:', err);
        }
        return;
      }

      const parentId = replyingTo?.id || undefined;
      const originalReplyMsg = replyingTo;
      setReplyingTo(null); // Clear reply state immediately

      const tempId = crypto.randomUUID();
      const optimistic: ChatMessage = {
        id: tempId,
        tempId,
        conversationId: room.id,
        senderId: currentUser.id,
        type: 'TEXT',
        content,
        enquiryId: null,
        isPinned: false,
        isDeleted: false,
        editedAt: null,
        createdAt: new Date().toISOString(),
        sender: {
          id: currentUser.id,
          displayName: currentUser.displayName,
          userName: currentUser.userName,
        },
        attachments: [],
        enquiry: null,
        pending: true,
        parentMessageId: parentId || null,
        parentMessage: originalReplyMsg || null,
        isStarred: false,
      };

      isAtBottomRef.current = true; // sending always jumps you to your message
      setMessages((prev) => [...prev, optimistic]);

      try {
        const saved = await sendChatMessage(room.id, content, parentId);
        // Replace the optimistic row with the persisted message.
        setMessages((prev) => prev.map((m) => (m.tempId === tempId ? saved : m)));
      } catch {
        // Mark the optimistic row as failed so the user can see it didn't send.
        setMessages((prev) =>
          prev.map((m) => (m.tempId === tempId ? { ...m, pending: false, failed: true } : m)),
        );
      }
    },
    [room, currentUser, editingMessage, replyingTo],
  );

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
          <button
            className={styles.headerIconBtn}
            title="Search"
            aria-label="Search messages"
            onClick={() => { setShowMembers(false); setShowSearch((p) => !p); }}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button
            className={styles.headerIconBtn}
            title="Members"
            aria-label="View members"
            onClick={() => { setShowSearch(false); setShowMembers((p) => !p); }}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Pinned Banner ── */}
      {pinnedMessages.length > 0 && (
        <div 
          className={styles.pinnedBanner}
          onClick={() => {
            const currentPinned = pinnedMessages[activePinnedIndex];
            if (currentPinned) {
              handleSelectSearchResult(currentPinned.id, '');
              if (pinnedMessages.length > 1) {
                setActivePinnedIndex((prev) => (prev + 1) % pinnedMessages.length);
              }
            }
          }}
        >
          <div className={styles.pinnedIcon}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.309-.806 1.692A15.957 15.957 0 0 1 9.5 7.125v4.947l1.176 1.176a.5.5 0 0 1-.354.852H5.678a.5.5 0 0 1-.353-.852L6.5 12.072V7.125A15.957 15.957 0 0 1 4.806 1.692c-.464-.383-.806-1.013-.806-1.692z" />
            </svg>
          </div>
          <div className={styles.pinnedContent}>
            <p className={styles.pinnedTitle}>
              Pinned Message {pinnedMessages.length > 1 ? `(${activePinnedIndex + 1}/${pinnedMessages.length})` : ''}
            </p>
            <p className={styles.pinnedText}>
              <strong>{pinnedMessages[activePinnedIndex].sender.displayName || pinnedMessages[activePinnedIndex].sender.userName}: </strong>
              {pinnedMessages[activePinnedIndex].content}
            </p>
          </div>
          <button
            className={styles.pinnedClose}
            onClick={async (e) => {
              e.stopPropagation();
              const targetMsg = pinnedMessages[activePinnedIndex];
              if (targetMsg && room) {
                try {
                  const updated = await pinChatMessage(room.id, targetMsg.id);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === targetMsg.id ? { ...m, isPinned: updated.isPinned } : m))
                  );
                  setPinnedMessages((prev) => prev.filter((p) => p.id !== targetMsg.id));
                  setActivePinnedIndex(0);
                } catch (err) {
                  console.error('Failed to unpin message:', err);
                }
              }
            }}
            title="Unpin message"
            aria-label="Unpin message"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Message list ── */}
      <div className={styles.messageList} ref={listRef} onScroll={handleListScroll}>
        {loading ? (
          <div className={styles.stateNote}>Loading messages…</div>
        ) : error ? (
          <div className={styles.stateNote}>{error}</div>
        ) : messages.length === 0 ? (
          <div className={styles.stateNote}>No messages yet. Say hello 👋</div>
        ) : (
          messages
            .filter((msg) => !msg.deletedFor?.includes(currentUserId ?? ''))
            .map((msg, index, filteredMessages) => {
              const mine = msg.senderId === currentUserId;
              const senderName = msg.sender.displayName || msg.sender.userName;
              const isFocused = msg.id === highlightMessageId;
              const isMenuOpen = msg.id === activeMenuId;
              const isNearBottom = filteredMessages.length > 7 && index >= filteredMessages.length - 6;

              const isDeletedByUser = msg.isDeleted;
              const deleteText = (msg.isDeleted && mine) 
                ? 'You deleted this message' 
                : 'This message was deleted';

            return (
              <div
                key={msg.id}
                id={`teamchat-msg-${msg.id}`}
                className={`${styles.row} ${mine ? styles.rowMine : styles.rowTheirs}`}
                onDoubleClick={() => {
                  if (!isDeletedByUser) {
                    setReplyingTo(msg);
                    setEditingMessage(null);
                  }
                }}
              >
                <div
                  className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs} ${msg.pending ? styles.bubblePending : ''}`}
                >
                  {!mine && <div className={styles.senderName}>{senderName}</div>}

                  {msg.parentMessage && !isDeletedByUser && (
                    <div 
                      className={styles.replyQuote}
                      onClick={(e) => {
                        e.stopPropagation();
                        const parentEl = document.getElementById(`teamchat-msg-${msg.parentMessageId}`);
                        if (parentEl) {
                          parentEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }
                      }}
                    >
                      <div className={styles.replyQuoteSender}>
                        {msg.parentMessage.sender.displayName || msg.parentMessage.sender.userName}
                      </div>
                      <div className={styles.replyQuoteBody}>
                        {msg.parentMessage.isDeleted ? 'This message was deleted' : msg.parentMessage.content}
                      </div>
                    </div>
                  )}

                  {isDeletedByUser ? (
                    <span style={{ fontStyle: 'italic', opacity: 0.6, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, verticalAlign: 'middle' }}>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      {deleteText}
                    </span>
                  ) : (
                    <span>
                      {isFocused
                        ? highlightKeyword(msg.content ?? '', highlightTerm, styles.highlight)
                        : msg.content}
                    </span>
                  )}

                  {!isDeletedByUser && (
                    <button
                      className={styles.bubbleArrow}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(isMenuOpen ? null : msg.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                      }}
                      title="Message actions"
                      aria-label="Message actions"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}

                  {isMenuOpen && !isDeletedByUser && (
                    <div 
                      className={styles.contextMenu}
                      style={{ 
                        ...(isNearBottom ? { bottom: '24px' } : { top: '24px' }), 
                        right: mine ? '0' : 'auto', 
                        left: mine ? 'auto' : '0' 
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className={styles.contextMenuItem}
                        onClick={() => {
                          setReplyingTo(msg);
                          setEditingMessage(null);
                          setActiveMenuId(null);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <polyline points="9 17 4 12 9 7" />
                          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                        Reply
                      </button>
                      <button
                        className={styles.contextMenuItem}
                        onClick={() => {
                          if (msg.content) {
                            navigator.clipboard.writeText(msg.content);
                          }
                          setActiveMenuId(null);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2-2v1" />
                        </svg>
                        Copy
                      </button>
                      <button
                        className={styles.contextMenuItem}
                        onClick={async () => {
                          setActiveMenuId(null);
                          if (room) {
                            try {
                              const updated = await pinChatMessage(room.id, msg.id);
                              setMessages((prev) =>
                                prev.map((m) => (m.id === msg.id ? { ...m, isPinned: updated.isPinned } : m))
                              );
                              if (updated.isPinned) {
                                fetchPinned();
                              } else {
                                setPinnedMessages((prev) => prev.filter((p) => p.id !== msg.id));
                              }
                            } catch (err) {
                              console.error('Failed to toggle pin:', err);
                            }
                          }
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <line x1="12" y1="17" x2="12" y2="22" />
                          <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.5A2 2 0 0 1 15 9.26V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.26a2 2 0 0 1-.78 1.24l-2.78 3.5a2 2 0 0 0-.44 1.24Z" />
                        </svg>
                        {msg.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        className={styles.contextMenuItem}
                        onClick={() => {
                          setActiveMenuId(null);
                          alert('Ask Meta AI is coming soon!');
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
                          <path d="M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5z" strokeDasharray="2 2" />
                        </svg>
                        Ask Meta AI
                      </button>
                      <button
                        className={styles.contextMenuItem}
                        onClick={async () => {
                          setActiveMenuId(null);
                          if (room) {
                            try {
                              const updated = await starChatMessage(room.id, msg.id);
                              setMessages((prev) =>
                                prev.map((m) => (m.id === msg.id ? { ...m, isStarred: updated.isStarred } : m))
                              );
                            } catch (err) {
                              console.error('Failed to toggle star:', err);
                            }
                          }
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        {msg.isStarred ? 'Unstar' : 'Star'}
                      </button>
                      {mine && (
                        <button
                          className={styles.contextMenuItem}
                          onClick={() => {
                            setEditingMessage(msg);
                            setReplyingTo(null);
                            setActiveMenuId(null);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Edit
                        </button>
                      )}
                      <button
                        className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                        onClick={() => {
                          setActiveMenuId(null);
                          setDeleteTargetMessage(msg);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }}>
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}

                  <span className={styles.bubbleTime}>
                    {formatTime(msg.createdAt)}
                    {msg.isStarred && !isDeletedByUser && <span className={styles.starIcon}>★</span>}
                    {mine && !isDeletedByUser && (
                      <DeliveryTicks status={tickStatus(msg, receipts)} className={styles.tick} />
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Scroll to newest ── */}
      {(showScrollDown || isAnchored) && (
        <button
          className={styles.scrollDownBtn}
          onClick={scrollToNewest}
          title={isAnchored ? 'Jump to latest' : 'Scroll to latest'}
          aria-label="Scroll to latest message"
        >
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* ── Composer ── */}
      <ChatComposer 
        onSend={handleSend}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
      />

      {/* ── Members drawer ── */}
      {showMembers && room && (
        <MembersSidebar roomId={room.id} onClose={() => setShowMembers(false)} />
      )}

      {/* ── Search drawer ── */}
      {showSearch && room && (
        <SearchSidebar
          roomId={room.id}
          currentUserId={currentUserId}
          onSelect={handleSelectSearchResult}
          onClose={closeSearch}
        />
      )}

      {/* ── Delete Message Modal ── */}
      {deleteTargetMessage && (
        <div className={styles.modalBackdrop} onClick={() => setDeleteTargetMessage(null)}>
          <div className={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Delete message?</h3>
            <p className={styles.modalBody}>
              {deleteTargetMessage.senderId === currentUserId
                ? "Do you want to delete this message for everyone or just for yourself?"
                : "This message will be deleted for you only. Others will still be able to see it."}
            </p>
            <div className={styles.modalActions}>
              {deleteTargetMessage.senderId === currentUserId && (
                <button
                  type="button"
                  className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
                  onClick={async () => {
                    const msg = deleteTargetMessage;
                    setDeleteTargetMessage(null);
                    if (room) {
                      try {
                        await deleteChatMessage(room.id, msg.id, true);
                        setMessages((prev) =>
                          prev.map((m) => (m.id === msg.id ? { ...m, isDeleted: true, content: 'This message was deleted' } : m))
                        );
                        setPinnedMessages((prev) => prev.filter((p) => p.id !== msg.id));
                      } catch (err) {
                        console.error('Failed to delete message for everyone:', err);
                      }
                    }
                  }}
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
                onClick={async () => {
                  const msg = deleteTargetMessage;
                  setDeleteTargetMessage(null);
                  if (room) {
                    try {
                      await deleteChatMessage(room.id, msg.id, false);
                      // Remove the deleted message locally
                      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                      setPinnedMessages((prev) => prev.filter((p) => p.id !== msg.id));
                    } catch (err) {
                      console.error('Failed to delete message for me:', err);
                    }
                  }
                }}
              >
                Delete for me
              </button>
              <button
                type="button"
                className={`${styles.modalBtn} ${styles.modalBtnCancel}`}
                onClick={() => setDeleteTargetMessage(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
