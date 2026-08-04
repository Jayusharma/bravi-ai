import { create } from 'zustand';
import { Channel } from '@/contracts/socketEvents';
import { SendMessageInput } from '@/channels/types';

/**
 * ============================================================================
 * STEP 5: ZUSTAND INBOX STORE (Layer 3)
 * Spec Ref: Section 7 & Section 2 (L3)
 * Browser-only truth (Zustand). Holds tab-local state: active contact, connection status,
 * unread watermarks, outbox retry queue, typing indicators, and drafts.
 * 
 * HARD INVARIANTS:
 * - Wiped on refresh. If it can be re-fetched from DB -> put in L4 (TanStack Query).
 * - Component selectors MUST return primitive values or use shallow comparison.
 *   Never return a new object literal in a selector without useShallow!
 * ============================================================================
 */

export interface TypingUser {
  userId: string;
  userName: string;
  expiresAt: number;
}

export interface DraftState {
  body: string;
  channel: Channel;
  extras?: Record<string, unknown>;
}

export interface OutboxEntry {
  clientMessageId: string;
  contactId: string;
  channel: Channel;
  status: 'SENDING' | 'FAILED';
  attempts: number;
  firstAttemptAt: number;
  payload: SendMessageInput;
}

export interface InboxStoreState {
  // Navigation & View Filtering
  activeContactId: string | null;
  channelFilter: Channel | 'ALL';

  // Network & Sequence Cursors
  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  lastSeqByContact: Record<string, number>;

  // Unread Watermarks (Local UI copy, seeded from server)
  unreadByContact: Record<string, number>;
  totalUnread: number;

  // Outbox Retry Queue (Keyed by clientMessageId)
  outbox: Record<string, OutboxEntry>;

  // Real-time Ephemeral State
  typingByContact: Record<string, TypingUser[]>;
  onlineUserIds: string[];

  // Form Drafts (Survives tab switching)
  draftByContact: Record<string, DraftState>;

  // Actions
  setActiveContactId: (id: string | null) => void;
  setChannelFilter: (filter: Channel | 'ALL') => void;
  setConnectionStatus: (status: 'connected' | 'reconnecting' | 'offline') => void;
  updateLastSeq: (contactId: string, seq: number) => void;

  incrementUnread: (contactId: string) => void;
  clearUnread: (contactId: string) => void;
  seedUnreadCounts: (counts: Record<string, number>) => void;

  setOutboxEntry: (clientMessageId: string, entry: OutboxEntry) => void;
  removeOutboxEntry: (clientMessageId: string) => void;
  markOutboxFailed: (clientMessageId: string) => void;

  setTyping: (contactId: string, user: Omit<TypingUser, 'expiresAt'>) => void;
  clearTyping: (contactId: string, userId: string) => void;
  setPresence: (userId: string, online: boolean) => void;

  saveDraft: (contactId: string, draft: DraftState) => void;
  clearDraft: (contactId: string) => void;
}

export const useInboxStore = create<InboxStoreState>((set, get) => ({
  activeContactId: null,
  channelFilter: 'ALL',

  connectionStatus: 'connected',
  lastSeqByContact: {},

  unreadByContact: {},
  totalUnread: 0,

  outbox: {},

  typingByContact: {},
  onlineUserIds: [],

  draftByContact: {},

  // Navigation & Filtering
  setActiveContactId: (id) => set({ activeContactId: id }),
  setChannelFilter: (filter) => set({ channelFilter: filter }),

  // Network & Cursors
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  updateLastSeq: (contactId, seq) =>
    set((state) => ({
      lastSeqByContact: {
        ...state.lastSeqByContact,
        [contactId]: Math.max(state.lastSeqByContact[contactId] || 0, seq),
      },
    })),

  // Unread Watermark Actions
  incrementUnread: (contactId) =>
    set((state) => {
      const current = state.unreadByContact[contactId] || 0;
      const nextMap = { ...state.unreadByContact, [contactId]: current + 1 };
      const nextTotal = Object.values(nextMap).reduce((sum, n) => sum + n, 0);
      return { unreadByContact: nextMap, totalUnread: nextTotal };
    }),

  clearUnread: (contactId) =>
    set((state) => {
      if (!state.unreadByContact[contactId]) return state;
      const nextMap = { ...state.unreadByContact };
      delete nextMap[contactId];
      const nextTotal = Object.values(nextMap).reduce((sum, n) => sum + n, 0);
      return { unreadByContact: nextMap, totalUnread: nextTotal };
    }),

  seedUnreadCounts: (counts) =>
    set(() => {
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      return { unreadByContact: counts, totalUnread: total };
    }),

  // Outbox Queue Actions
  setOutboxEntry: (clientMessageId, entry) =>
    set((state) => ({
      outbox: { ...state.outbox, [clientMessageId]: entry },
    })),

  removeOutboxEntry: (clientMessageId) =>
    set((state) => {
      const next = { ...state.outbox };
      delete next[clientMessageId];
      return { outbox: next };
    }),

  markOutboxFailed: (clientMessageId) =>
    set((state) => {
      const entry = state.outbox[clientMessageId];
      if (!entry) return state;
      return {
        outbox: {
          ...state.outbox,
          [clientMessageId]: { ...entry, status: 'FAILED' },
        },
      };
    }),

  // Typing & Presence Actions
  setTyping: (contactId, user) =>
    set((state) => {
      const current = state.typingByContact[contactId] || [];
      const expiresAt = Date.now() + 4000; // Auto-expire typing after 4s (Spec §15 #19)
      const filtered = current.filter((u) => u.userId !== user.userId);
      return {
        typingByContact: {
          ...state.typingByContact,
          [contactId]: [...filtered, { ...user, expiresAt }],
        },
      };
    }),

  clearTyping: (contactId, userId) =>
    set((state) => {
      const current = state.typingByContact[contactId] || [];
      const filtered = current.filter((u) => u.userId !== userId);
      return {
        typingByContact: {
          ...state.typingByContact,
          [contactId]: filtered,
        },
      };
    }),

  setPresence: (userId, online) =>
    set((state) => ({
      onlineUserIds: online
        ? Array.from(new Set([...state.onlineUserIds, userId]))
        : state.onlineUserIds.filter((id) => id !== userId),
    })),

  // Draft Actions
  saveDraft: (contactId, draft) =>
    set((state) => ({
      draftByContact: { ...state.draftByContact, [contactId]: draft },
    })),

  clearDraft: (contactId) =>
    set((state) => {
      const next = { ...state.draftByContact };
      delete next[contactId];
      return { draftByContact: next };
    }),
}));

// ── Decision Logic Stubs ──

export function sweepStuckOutboxMessages(): void {
  const { outbox, markOutboxFailed } = useInboxStore.getState();
  const now = Date.now();

  for (const entry of Object.values(outbox)) {
    if (entry.status === 'SENDING' && now - entry.firstAttemptAt > 30_000) {
      console.warn(`⏳ [Outbox Sweeper] Message ${entry.clientMessageId} timed out after 30s — marking FAILED.`);
      markOutboxFailed(entry.clientMessageId);
    }
  }
}
