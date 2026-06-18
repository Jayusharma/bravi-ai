'use server';
import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

// ── Types (mirror backend chat.service.ts payloads) ──────────────

export type ChatRoom = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  lastMessageAt: string | null;
  memberCount: number;
  lastReadAt: string | null;
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

/** Paginated message history, returned oldest → newest. */
export async function getChatMessages(
  roomId: string,
  params?: { limit?: number; cursor?: string },
): Promise<ChatMessagesResponse> {
  return apiClient<ChatMessagesResponse>(API.CHAT.MESSAGES(roomId), { params });
}
