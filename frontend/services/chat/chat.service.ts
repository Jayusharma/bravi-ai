'use server';
import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

// ── Types (mirror backend chat.service.ts payloads) ──────────────

export type ChatReceipts = {
  /** Every member has received messages up to this time → DELIVERED (✓✓). */
  deliveredUpTo: string | null;
  /** Every member has read messages up to this time → READ (blue ✓✓). */
  readUpTo: string | null;
};

export type ChatRoom = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  description?: string | null;
  key?: string | null; // 'COMMON_ROOM' marks #general
  archivedAt?: string | null;
  myRole?: 'MEMBER' | 'ADMIN' | null;
  lastMessageAt: string | null;
  memberCount: number;
  lastReadAt: string | null; // read boundary for the unread divider
  unreadCount: number;
  firstUnreadMessageId: string | null; // page opens positioned here
  receipts: ChatReceipts;
};

export type ChatMessageType = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'ENQUIRY_CARD';

export type ChatAttachment = {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  cdnUrl: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

export type ChatMessageSender = {
  id: string;
  displayName: string | null;
  userName: string;
};

export type ChatEnquiryCard = {
  id: string;
  status: string;
  intent: string | null;
  contact: { displayName: string } | null;
};

/** One raw reaction row — the client groups these into {emoji, count, reactedByMe}. */
export type ChatReaction = {
  userId: string;
  emoji: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  content: string | null;
  enquiryId: string | null;
  isPinned: boolean;
  isDeleted: boolean;
  editedAt: string | null;
  createdAt: string;
  sender: ChatMessageSender;
  attachments: ChatAttachment[];
  enquiry: ChatEnquiryCard | null;
  reactions: ChatReaction[];

  parentMessageId: string | null;
  parentMessage: ChatMessage | null;
  isStarred: boolean;
  deletedFor?: string[];

  // Client-only fields for optimistic sending (not present on server payloads).
  tempId?: string;
  pending?: boolean;
  failed?: boolean;
};

/** One sidebar row: a channel or DM I'm a member of. Mirrors listConversations() backend. */
export type ChatConversationSummary = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null; // channel name, or the DM partner's name
  description: string | null;
  key: string | null; // 'COMMON_ROOM' marks #general (leave disabled)
  archivedAt: string | null;
  memberCount: number;
  myRole: 'MEMBER' | 'ADMIN';
  dmPartnerId: string | null;
  lastMessageAt: string | null;
  lastMessage: {
    content: string | null;
    type: ChatMessageType;
    senderId: string;
    senderName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
};

/** Descriptor returned by the upload endpoint; sent back with the message. */
export type ChatAttachmentDescriptor = {
  kind: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  cdnUrl: string | null;
};

/** One row in the Files tab: an attachment plus its message context. */
export type ChatFileItem = ChatAttachment & {
  storageKey?: string;
  createdAt: string;
  message: {
    id: string;
    senderId: string;
    createdAt: string;
    sender: { displayName: string | null; userName: string };
  };
};

export type ChatMessagesResponse = {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

// ── API ──────────────────────────────────────────────────────────

/** Resolves (and lazily creates + joins) the org-wide #general channel. */
export async function getChatRoom(): Promise<ChatRoom> {
  return apiClient<ChatRoom>(API.CHAT.ROOM);
}

/** Bootstrap metadata for ANY channel/DM I'm a member of — opens the room view. */
export async function getChatRoomMeta(roomId: string): Promise<ChatRoom> {
  return apiClient<ChatRoom>(API.CHAT.META(roomId));
}

/** Read-only unread count for the common room — seeds the sidebar badge. */
export async function getChatUnread(): Promise<{ conversationId: string | null; count: number }> {
  return apiClient<{ conversationId: string | null; count: number }>(API.CHAT.UNREAD);
}

/** Paginated message history, returned oldest → newest. */
export async function getChatMessages(
  roomId: string,
  params?: { limit?: number; cursor?: string },
): Promise<ChatMessagesResponse> {
  return apiClient<ChatMessagesResponse>(API.CHAT.MESSAGES(roomId), { params });
}

/** Load the next NEWER page after a cursor (oldest → newest). */
export async function getChatMessagesNewer(
  roomId: string,
  cursor: string,
  limit?: number,
): Promise<ChatMessagesResponse> {
  return apiClient<ChatMessagesResponse>(API.CHAT.NEWER(roomId), {
    params: { cursor, limit },
  });
}

/**
 * Load a window of messages centered on `messageId` (for jumping to a search
 * result that isn't currently loaded). Returns oldest → newest.
 */
export async function getChatMessagesAround(
  roomId: string,
  messageId: string,
  before?: number,
  after?: number,
): Promise<{ messages: ChatMessage[]; hasMoreOlder: boolean; hasMoreNewer: boolean }> {
  return apiClient<{ messages: ChatMessage[]; hasMoreOlder: boolean; hasMoreNewer: boolean }>(
    API.CHAT.AROUND(roomId),
    { params: { messageId, before, after } },
  );
}

/** Keyword search within the room. Returns newest matches first. */
export async function searchChatMessages(
  roomId: string,
  q: string,
  limit?: number,
): Promise<{ messages: ChatMessage[] }> {
  return apiClient<{ messages: ChatMessage[] }>(API.CHAT.SEARCH(roomId), {
    params: { q, limit },
  });
}

export type ChatMember = {
  userId: string;
  displayName: string | null;
  userName: string;
  role: string;
  isOnline: boolean;
  lastSeenAt: string | null;
};

/** Active members of the room with name, org role, and presence. */
export async function getChatMembers(roomId: string): Promise<ChatMember[]> {
  return apiClient<ChatMember[]>(API.CHAT.MEMBERS(roomId));
}

export async function getPinnedMessages(roomId: string): Promise<ChatMessage[]> {
  return apiClient<ChatMessage[]>(API.CHAT.PINNED(roomId));
}

/** Starred messages of the room — powers the Starred tab. Newest first. */
export async function getStarredMessages(roomId: string): Promise<ChatMessage[]> {
  return apiClient<ChatMessage[]>(API.CHAT.STARRED_LIST(roomId));
}

/** Send a message (text and/or uploaded attachments). Returns the persisted, hydrated message. */
export async function sendChatMessage(
  roomId: string,
  content: string,
  parentMessageId?: string,
  attachments?: ChatAttachmentDescriptor[],
): Promise<ChatMessage> {
  return apiClient<ChatMessage>(API.CHAT.MESSAGES(roomId), {
    method: 'POST',
    body: { content: content || undefined, parentMessageId, attachments },
  });
}

// ── Channels & DMs (Discord-style) ───────────────────────────────

/** My sidebar: every channel + DM I'm an active member of, with unread counts. */
export async function listConversations(includeArchived = false): Promise<ChatConversationSummary[]> {
  return apiClient<ChatConversationSummary[]>(API.CHAT.CONVERSATIONS, {
    params: includeArchived ? { includeArchived: 'true' } : undefined,
  });
}

/** Create a channel (admin/manager only). Creator becomes the channel admin. */
export async function createChannel(input: {
  name: string;
  description?: string;
  memberIds?: string[];
}): Promise<{ id: string }> {
  return apiClient<{ id: string }>(API.CHAT.CHANNELS, { method: 'POST', body: input });
}

/** Rename / edit description / archive-restore a channel (channel admin). */
export async function updateChannel(
  id: string,
  input: { name?: string; description?: string; archived?: boolean },
): Promise<{ id: string }> {
  return apiClient<{ id: string }>(API.CHAT.CHANNEL(id), { method: 'PATCH', body: input });
}

/** Add people to a channel (channel admin). Returns the updated member list. */
export async function addChannelMembers(id: string, userIds: string[]): Promise<ChatMember[]> {
  return apiClient<ChatMember[]>(API.CHAT.CHANNEL_MEMBERS(id), {
    method: 'POST',
    body: { userIds },
  });
}

/** Kick a member (channel admin) or leave yourself (pass your own userId). */
export async function removeChannelMember(id: string, userId: string): Promise<void> {
  return apiClient<void>(API.CHAT.CHANNEL_MEMBER(id, userId), { method: 'DELETE' });
}

/** Open (or find) the 1-to-1 DM with a user — same pair always → same conversation. */
export async function openDm(userId: string): Promise<{ id: string }> {
  return apiClient<{ id: string }>(API.CHAT.DM, { method: 'POST', body: { userId } });
}

/** Files tab: paginated attachments in this conversation, newest first. */
export async function getChannelFiles(
  roomId: string,
  params?: { limit?: number; cursor?: string },
): Promise<{ files: ChatFileItem[]; nextCursor: string | null; hasMore: boolean }> {
  return apiClient<{ files: ChatFileItem[]; nextCursor: string | null; hasMore: boolean }>(
    API.CHAT.FILES(roomId),
    { params },
  );
}

/** Toggle an emoji reaction on a message. Returns the message's full reaction list. */
export async function toggleChatReaction(
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<{ messageId: string; reactions: ChatReaction[] }> {
  return apiClient<{ messageId: string; reactions: ChatReaction[] }>(
    API.CHAT.REACTIONS(roomId, messageId),
    { method: 'POST', body: { emoji } },
  );
}

export async function pinChatMessage(roomId: string, messageId: string): Promise<ChatMessage> {
  return apiClient<ChatMessage>(API.CHAT.PIN(roomId, messageId), {
    method: 'PATCH',
  });
}

export async function starChatMessage(roomId: string, messageId: string): Promise<ChatMessage> {
  return apiClient<ChatMessage>(API.CHAT.STAR(roomId, messageId), {
    method: 'PATCH',
  });
}

export async function editChatMessage(roomId: string, messageId: string, content: string): Promise<ChatMessage> {
  return apiClient<ChatMessage>(API.CHAT.EDIT(roomId, messageId), {
    method: 'PATCH',
    body: { content },
  });
}

export async function deleteChatMessage(
  roomId: string,
  messageId: string,
  deleteForEveryone: boolean,
): Promise<any> {
  return apiClient<any>(API.CHAT.DELETE(roomId, messageId), {
    method: 'DELETE',
    params: { deleteForEveryone: String(deleteForEveryone) },
  });
}
