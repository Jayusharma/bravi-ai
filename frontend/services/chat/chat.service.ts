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

  parentMessageId: string | null;
  parentMessage: ChatMessage | null;
  isStarred: boolean;
  deletedFor?: string[];

  // Client-only fields for optimistic sending (not present on server payloads).
  tempId?: string;
  pending?: boolean;
  failed?: boolean;
};

export type ChatMessagesResponse = {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

// ── API ──────────────────────────────────────────────────────────

/** Resolves (and lazily creates + joins) the org-wide common room. */
export async function getChatRoom(): Promise<ChatRoom> {
  return apiClient<ChatRoom>(API.CHAT.ROOM);
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

/** Send a text message to the room. Returns the persisted, hydrated message. */
export async function sendChatMessage(
  roomId: string,
  content: string,
  parentMessageId?: string,
): Promise<ChatMessage> {
  return apiClient<ChatMessage>(API.CHAT.MESSAGES(roomId), {
    method: 'POST',
    body: { content, parentMessageId },
  });
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
