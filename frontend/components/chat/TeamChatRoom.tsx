'use client';

// TeamChatRoom — the open channel/DM (center pane of the Discord-style layout).
// Generalized: takes a conversationId prop; ChatShell remounts it per conversation.
// Tabs: Messages (live thread) | Files (attachment gallery) | Pinned (pin list).

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { useSocket } from '@/contexts/SocketContext';
import {
  getChatRoomMeta,
  getChatMessages,
  getChatMessagesAround,
  getChatMessagesNewer,
  sendChatMessage,
  pinChatMessage,
  starChatMessage,
  editChatMessage,
  deleteChatMessage,
  getPinnedMessages,
  getStarredMessages,
  toggleChatReaction,
  type ChatRoom,
  type ChatMessage,
  type ChatReceipts,
  type ChatReaction,
  type ChatAttachmentDescriptor,
} from '@/services/chat/chat.service';
import { useAuthStore } from '@/stores/auth-store';
import { getSocket, joinChatRoom, leaveChatRoom } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { DeliveryTicks } from '@/components/messaging/chat/DeliveryTicks';
import { SearchSidebar } from './SearchSidebar';
import { ReactionBar, QUICK_EMOJIS } from './ReactionBar';
import { ChannelFilesTab } from './ChannelFilesTab';
import { highlightKeyword } from './highlight';
import styles from '@/styles/TeamChat.module.css';

type RoomTab = 'messages' | 'files' | 'starred';

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

interface TeamChatRoomProps {
  /** Which channel/DM to show — ChatShell remounts this component per conversation (key). */
  conversationId: string;
  /** Opens/closes the right-hand Channel Details panel. */
  onOpenDetails?: () => void;
}

export function TeamChatRoom({ conversationId, onOpenDetails }: TeamChatRoomProps) {
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ?? null;
  const { setActiveChatConversation } = useSocket();

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [activeTab, setActiveTab] = useState<RoomTab>('messages');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ChatReceipts>(EMPTY_RECEIPTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [starredMessages, setStarredMessages] = useState<ChatMessage[]>([]);
  const [activePinnedIndex, setActivePinnedIndex] = useState<number>(0);
  const [deleteTargetMessage, setDeleteTargetMessage] = useState<ChatMessage | null>(null);

  // Unread divider (captured once at load — the read boundary BEFORE this open).
  const [readBoundary, setReadBoundary] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Pagination / anchored-window state for jumping to old messages.
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [hasMoreNewer, setHasMoreNewer] = useState(false);
  const [isAnchored, setIsAnchored] = useState(false); // viewing a historical window, not the live tail

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const isAnchoredRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const pendingPrependHeightRef = useRef<number | null>(null);

  // Mirror isAnchored into a ref so the socket callback reads the latest value.
  useEffect(() => { isAnchoredRef.current = isAnchored; }, [isAnchored]);

  // Fetch pinned messages (thread banner)
  const fetchPinned = useCallback(async () => {
    if (!room) return;
    try {
      const pinned = await getPinnedMessages(room.id);
      setPinnedMessages(pinned);
    } catch (err) {
      console.error('Failed to load pinned messages:', err);
    }
  }, [room]);

  // Fetch starred messages (the Starred tab)
  const fetchStarred = useCallback(async () => {
    if (!room) return;
    try {
      const starred = await getStarredMessages(room.id);
      setStarredMessages(starred);
    } catch (err) {
      console.error('Failed to load starred messages:', err);
    }
  }, [room]);

  useEffect(() => {
    if (room) {
      fetchPinned();
      fetchStarred();
    }
  }, [room, fetchPinned, fetchStarred]);

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

  // Load THIS conversation's metadata + first page of history on mount.
  // (ChatShell remounts us via key when the conversation changes.)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const r = await getChatRoomMeta(conversationId);
        if (!active) return;
        setRoom(r);
        setReceipts(r.receipts ?? EMPTY_RECEIPTS);
        // Capture the read boundary + count BEFORE the room is marked read on join,
        // so the "unread" divider knows where the unread messages begin.
        setReadBoundary(r.lastReadAt);
        setUnreadCount(r.unreadCount);

        if (r.unreadCount > 0 && r.firstUnreadMessageId) {
          // Open positioned AT the first unread message (works for any backlog
          // size — the first unread may be far older than the newest page).
          const win = await getChatMessagesAround(r.id, r.firstUnreadMessageId, 10, 30);
          if (!active) return;
          setMessages(win.messages);
          setOlderCursor(win.messages[0]?.id ?? null);
          setHasMoreOlder(win.hasMoreOlder);
          setNewerCursor(win.messages[win.messages.length - 1]?.id ?? null);
          setHasMoreNewer(win.hasMoreNewer);
          setIsAnchored(win.hasMoreNewer);
          isAtBottomRef.current = false; // don't snap to bottom
          // Scroll the unread divider to the top once it has rendered.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el =
                document.getElementById('teamchat-unread-divider') ??
                document.getElementById(`teamchat-msg-${r.firstUnreadMessageId}`);
              el?.scrollIntoView({ block: 'start', behavior: 'auto' });
            }),
          );
        } else {
          // Caught up → newest page, land at the bottom (default behavior).
          const history = await getChatMessages(r.id);
          if (!active) return;
          setMessages(history.messages);
          setOlderCursor(history.nextCursor);
          setHasMoreOlder(history.hasMore);
          setNewerCursor(null);
          setHasMoreNewer(false);
          setIsAnchored(false);
        }
      } catch {
        if (active) setError('Could not load the chat. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [conversationId]);

  // Viewing this conversation zeroes ITS badge and suppresses further increments.
  useEffect(() => {
    setActiveChatConversation(conversationId);
    return () => setActiveChatConversation(null);
  }, [conversationId, setActiveChatConversation]);

  // First unread message (from the boundary captured at load) → where the divider goes.
  const firstUnreadId = useMemo(() => {
    if (unreadCount <= 0) return null;
    const boundary = readBoundary ? new Date(readBoundary).getTime() : null;
    for (const m of messages) {
      if (m.senderId === currentUserId || m.isDeleted) continue;
      if (boundary === null || new Date(m.createdAt).getTime() > boundary) return m.id;
    }
    return null;
  }, [messages, readBoundary, unreadCount, currentUserId]);

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
      // Keep the Starred tab in sync: unstar drops it; star refetches (needs hydration)
      if (data.isStarred) {
        fetchStarred();
      } else {
        setStarredMessages((prev) => prev.filter((s) => s.id !== data.messageId));
      }
    };

    const onMessageEdited = (data: { conversationId: string; messageId: string; content: string; editedAt: string }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, content: data.content, editedAt: data.editedAt } : m))
      );
      setPinnedMessages((prev) =>
        prev.map((p) => (p.id === data.messageId ? { ...p, content: data.content, editedAt: data.editedAt } : p))
      );
      setStarredMessages((prev) =>
        prev.map((s) => (s.id === data.messageId ? { ...s, content: data.content, editedAt: data.editedAt } : s))
      );
    };

    const onMessageDeleted = (data: { conversationId: string; messageId: string; isDeleted: boolean }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, isDeleted: true, content: 'This message was deleted' } : m))
      );
      setPinnedMessages((prev) => prev.filter((p) => p.id !== data.messageId));
      setStarredMessages((prev) => prev.filter((s) => s.id !== data.messageId));
      setActivePinnedIndex(0);
    };

    // Reaction toggled by anyone (incl. our other tabs) → patch that message's raw rows.
    const onMessageReacted = (data: { conversationId: string; messageId: string; userId: string; emoji: string; added: boolean }) => {
      if (data.conversationId !== roomId) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== data.messageId) return m;
          const without = (m.reactions ?? []).filter((r) => !(r.userId === data.userId && r.emoji === data.emoji));
          const next: ChatReaction[] = data.added ? [...without, { userId: data.userId, emoji: data.emoji }] : without;
          return { ...m, reactions: next };
        }),
      );
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
      sock.on(SOCKET_EVENTS.CHAT_MESSAGE_REACTED, onMessageReacted);
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
      socketRef?.off(SOCKET_EVENTS.CHAT_MESSAGE_REACTED, onMessageReacted);
      leaveChatRoom(roomId);
    };
  }, [room, currentUserId, fetchPinned, fetchStarred]);

  // Toggle my reaction — optimistic flip, server + socket reconcile.
  const handleToggleReaction = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      if (!room || !currentUserId) return;
      const mineAlready = (msg.reactions ?? []).some((r) => r.userId === currentUserId && r.emoji === emoji);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msg.id) return m;
          const without = (m.reactions ?? []).filter((r) => !(r.userId === currentUserId && r.emoji === emoji));
          return { ...m, reactions: mineAlready ? without : [...without, { userId: currentUserId, emoji }] };
        }),
      );
      try {
        await toggleChatReaction(room.id, msg.id, emoji);
      } catch {
        // Revert on failure (rare) — flip back
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== msg.id) return m;
            const without = (m.reactions ?? []).filter((r) => !(r.userId === currentUserId && r.emoji === emoji));
            return { ...m, reactions: mineAlready ? [...without, { userId: currentUserId, emoji }] : without };
          }),
        );
      }
    },
    [room, currentUserId],
  );

  // Pin to newest. Only auto-scroll when the user is already at the bottom,
  // so incoming messages don't yank them away while they're reading history.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    // Don't snap to the bottom while anchored (reading an unread/historical window).
    if (isAtBottomRef.current && !isAnchoredRef.current) scrollToBottom();
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

  // Load the NEXT (newer) page and append it — bridges an anchored window
  // toward the live tail as the user scrolls down through unread messages.
  const loadNewer = useCallback(async () => {
    if (!room || loadingNewerRef.current || !hasMoreNewer || !newerCursor) return;
    loadingNewerRef.current = true;
    try {
      const res = await getChatMessagesNewer(room.id, newerCursor);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = res.messages.filter((m) => !seen.has(m.id));
        return [...prev, ...fresh];
      });
      setNewerCursor(res.nextCursor);
      setHasMoreNewer(res.hasMore);
      if (!res.hasMore) setIsAnchored(false); // reached the live tail
    } catch {
      /* ignore */
    } finally {
      loadingNewerRef.current = false;
    }
  }, [room, hasMoreNewer, newerCursor]);

  // Track scroll position → drives the "scroll to newest" button, auto-scroll,
  // and lazy-loading of older history (top) and newer history (bottom).
  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 120;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
    if (el.scrollTop < 80) loadOlder();
    if (isAnchoredRef.current && distanceFromBottom < 200) loadNewer();
  }, [loadOlder, loadNewer]);

  // Down-arrow: when viewing a historical window, reload the live tail; otherwise
  // just scroll to the bottom.
  const scrollToNewest = useCallback(async () => {
    if (isAnchored && room) {
      try {
        const history = await getChatMessages(room.id);
        setMessages(history.messages);
        setOlderCursor(history.nextCursor);
        setHasMoreOlder(history.hasMore);
        setNewerCursor(null);
        setHasMoreNewer(false);
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
        setNewerCursor(res.messages[res.messages.length - 1]?.id ?? null);
        setHasMoreNewer(res.hasMoreNewer);
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
  // Attachments were already uploaded by the composer — we get their descriptors.
  const handleSend = useCallback(
    async (content: string, attachmentDescriptors: ChatAttachmentDescriptor[] = []) => {
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
        // Preview the already-uploaded files instantly (temp ids; server rows replace them)
        attachments: attachmentDescriptors.map((d, i) => ({
          id: `temp-${tempId}-${i}`,
          kind: d.kind,
          fileName: d.fileName,
          mimeType: d.mimeType,
          fileSize: d.fileSize,
          cdnUrl: d.cdnUrl,
        })),
        enquiry: null,
        reactions: [],
        pending: true,
        parentMessageId: parentId || null,
        parentMessage: originalReplyMsg || null,
        isStarred: false,
      };

      isAtBottomRef.current = true; // sending always jumps you to your message
      setMessages((prev) => [...prev, optimistic]);

      try {
        const saved = await sendChatMessage(room.id, content, parentId, attachmentDescriptors.length ? attachmentDescriptors : undefined);
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

  const isDm = room?.type === 'DIRECT';

  return (
    <div className={styles.room}>
      {/* ── Header: identity + tabs + actions ── */}
      <div className={styles.header}>
        <div className={styles.headerAvatar}>{isDm ? (room?.name ?? '?').charAt(0).toUpperCase() : '#'}</div>
        <div className={styles.headerInfo}>
          <p className={styles.headerTitle}>{isDm ? room?.name : room?.name ? `# ${room.name}` : 'Loading…'}</p>
          <p className={styles.headerSubtitle}>
            {room?.description
              ? room.description
              : room
                ? `${room.memberCount} member${room.memberCount === 1 ? '' : 's'}`
                : ''}
          </p>
        </div>

        {/* Tabs: Messages | Files | Starred (pins live in the thread banner, not a tab) */}
        <div className="mx-3 flex items-center gap-1">
          {([['messages', 'Messages'], ['files', 'Files'], ['starred', 'Starred']] as [RoomTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === tab
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}
            >
              {label}
              {tab === 'starred' && starredMessages.length > 0 && (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold">{starredMessages.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.headerIconBtn}
            title="Search"
            aria-label="Search messages"
            onClick={() => setShowSearch((p) => !p)}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button
            className={styles.headerIconBtn}
            title="Channel details"
            aria-label="Channel details"
            onClick={() => onOpenDetails?.()}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Files tab ── */}
      {activeTab === 'files' && <ChannelFilesTab conversationId={conversationId} />}

      {/* ── Starred tab: your saved messages, click to jump, unstar inline ── */}
      {activeTab === 'starred' && (
        <div className="flex-1 overflow-y-auto p-4">
          {starredMessages.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No starred messages in this channel yet. Star one from its message menu.</p>
          ) : (
            <div className="space-y-2">
              {starredMessages.map((s) => (
                <div key={s.id} className="group flex items-start gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 text-amber-500">★</span>
                  <button
                    className="min-w-0 flex-1 text-left cursor-pointer"
                    onClick={() => { setActiveTab('messages'); handleSelectSearchResult(s.id, ''); }}
                    title="Jump to message"
                  >
                    <span className="block text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      {s.sender.displayName || s.sender.userName} · {formatTime(s.createdAt)}
                    </span>
                    <span className="mt-0.5 block truncate text-sm">{s.content}</span>
                  </button>
                  <button
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 cursor-pointer"
                    title="Unstar"
                    aria-label="Unstar message"
                    onClick={async () => {
                      if (!room) return;
                      try {
                        await starChatMessage(room.id, s.id);
                        setStarredMessages((prev) => prev.filter((x) => x.id !== s.id));
                        setMessages((prev) => prev.map((m) => (m.id === s.id ? { ...m, isStarred: false } : m)));
                      } catch { /* ignore */ }
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Pinned Banner (messages tab) ── */}
      {activeTab === 'messages' && pinnedMessages.length > 0 && (
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

      {/* ── Message list (messages tab) ── */}
      {activeTab === 'messages' && (
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
              <Fragment key={msg.id}>
                {msg.id === firstUnreadId && (
                  <div id="teamchat-unread-divider" className={styles.unreadDivider}>
                    {unreadCount} unread message{unreadCount === 1 ? '' : 's'}
                  </div>
                )}
              <div
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

                  {/* Attachments: image previews + document rows */}
                  {!isDeletedByUser && msg.attachments?.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {msg.attachments.map((att) =>
                        att.kind === 'IMAGE' && att.cdnUrl ? (
                          <a key={att.id} href={att.cdnUrl} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={att.cdnUrl} alt={att.fileName} className="max-h-64 max-w-full rounded-xl border border-black/5 object-cover" />
                          </a>
                        ) : (
                          <a
                            key={att.id}
                            href={att.cdnUrl ?? '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-inherit no-underline transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{att.fileName}</span>
                            <span className="shrink-0 text-xs opacity-70">{(att.fileSize / 1024 / 1024) >= 1 ? `${(att.fileSize / 1024 / 1024).toFixed(1)} MB` : `${Math.round(att.fileSize / 1024)} KB`}</span>
                          </a>
                        ),
                      )}
                    </div>
                  )}

                  {/* Reaction chips */}
                  {!isDeletedByUser && (
                    <ReactionBar
                      reactions={msg.reactions ?? []}
                      currentUserId={currentUserId}
                      onToggle={(emoji) => handleToggleReaction(msg, emoji)}
                    />
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
                      {/* Quick reactions — Discord-style fixed set, toggle on tap */}
                      <div style={{ display: 'flex', gap: 2, padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.15)', marginBottom: 4 }}>
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            className="rounded-md px-1.5 py-0.5 text-base transition-transform hover:scale-125 cursor-pointer"
                            onClick={() => {
                              setActiveMenuId(null);
                              handleToggleReaction(msg, emoji);
                            }}
                            title={`React ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
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
              </Fragment>
            );
          })
        )}
      </div>
      )}

      {/* ── Scroll to newest (messages tab) ── */}
      {activeTab === 'messages' && (showScrollDown || isAnchored) && (
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

      {/* ── Composer (messages tab; archived channels are read-only) ── */}
      {activeTab === 'messages' && !room?.archivedAt && (
        <ChatComposer
          conversationId={conversationId}
          onSend={handleSend}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          editingMessage={editingMessage}
          onCancelEdit={() => setEditingMessage(null)}
        />
      )}
      {activeTab === 'messages' && room?.archivedAt && (
        <div className="border-t border-border/40 bg-accent/30 px-4 py-3 text-center text-sm text-muted-foreground">
          This channel is archived — it is read-only.
        </div>
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
