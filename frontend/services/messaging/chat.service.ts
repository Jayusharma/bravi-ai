'use server';
import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

// ── Types ────────────────────────────────────────────────────────

export type ConversationPreview = {
  contactId: string;
  contactName: string;
  organization: string | null;
  channel: string | null;
  identifier: string | null;
  enquiryId: string;
  enquiryStatus: string;
  assignedTo: { id: string; displayName: string | null; userName: string } | null;
  messageCount: number;
  lastMessage: {
    content: string;
    direction: string;
    channel: string;
    createdAt: string;
  } | null;
  lastActivityAt: string;
  draft?: {
    body: string | null;
    attachmentCount: number;
    channel: string;
  } | null;
};

export type MessageAttachment = {
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

export type ThreadMessage = {
  id: string;
  content: string;
  direction: string;
  channel: string;
  from: string;
  to: string | null;
  subject?: string | null;
  deliveryStatus: string;
  createdAt: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  sentByUser: { id: string; displayName: string | null; userName: string } | null;
  reactions?: { emoji: string; count: number; userId?: string }[];
  attachments?: MessageAttachment[];
};

export type EnquiryThread = {
  enquiryId: string;
  status: string;
  type: string;
  intent: string | null;
  tags: string[];
  assignedTo: { id: string; displayName: string | null; userName: string } | null;
  messageCount: number;
  createdAt: string;
  lastActivityAt: string;
  messages: ThreadMessage[];
};

export type ConversationThread = {
  contact: {
    id: string;
    displayName: string;
    organization: string | null;
    channels: Array<{ channel: string; identifier: string; isPrimary: boolean }>;
  };
  enquiries: EnquiryThread[];
};

export type ConversationsResponse = {
  data: ConversationPreview[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

// ── Conversation API ─────────────────────────────────────────────

export async function getConversations(params?: {
  search?: string;
  page?: number;
  limit?: number;
  channel?: string;
}): Promise<ConversationsResponse> {
  return apiClient<ConversationsResponse>(API.CONVERSATION.LIST, { params });
}

export async function getConversationThread(contactId: string): Promise<ConversationThread> {
  return apiClient<ConversationThread>(API.CONVERSATION.THREAD(contactId));
}

// ── Outbound / Draft Types ───────────────────────────────────────

export type MessageChannel = 'EMAIL' | 'WHATSAPP' | 'SMS';
export type DraftStatus = 'ACTIVE' | 'EXPIRED' | 'CLEARED';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface DraftAttachment {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  cdnUrl: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export interface OutboundDraft {
  id: string;
  enquiryId: string;
  channel: MessageChannel;
  subject: string | null;
  body: string | null;
  status: DraftStatus;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  attachments?: DraftAttachment[];
}

export interface OutboundMessageAttachment {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  cdnUrl: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export interface OutboundMessage {
  id: string;
  enquiryId: string;
  channel: MessageChannel;
  direction: 'OUTBOUND';
  from: string;
  to: string | null;
  subject: string | null;
  content: string;
  externalId: string | null;
  deliveryStatus: DeliveryStatus;
  deliveredAt: string | null;
  readAt: string | null;
  draftId: string | null;
  sentByUserId: string | null;
  sentByUser: { id: string; displayName: string | null; userName: string } | null;
  attachments?: OutboundMessageAttachment[];
  createdAt: string;
}

export interface OutboundMessagesResponse {
  data: OutboundMessage[];
  total: number;
}

// ── Draft CRUD ───────────────────────────────────────────────────

export async function getActiveDraft(enquiryId: string): Promise<OutboundDraft | null> {
  return apiClient<OutboundDraft | null>(API.OUTBOUND.GET_DRAFT(enquiryId));
}

export async function createDraft(
  enquiryId: string,
  data: { channel: MessageChannel; subject?: string; body?: string; saveForLater?: boolean },
): Promise<OutboundDraft> {
  return apiClient<OutboundDraft>(API.OUTBOUND.CREATE_DRAFT(enquiryId), {
    method: 'POST',
    body: data,
  });
}

export async function updateDraft(
  draftId: string,
  data: { channel?: MessageChannel; subject?: string; body?: string },
): Promise<OutboundDraft> {
  return apiClient<OutboundDraft>(API.OUTBOUND.UPDATE_DRAFT(draftId), {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteDraft(draftId: string): Promise<void> {
  await apiClient<void>(API.OUTBOUND.DELETE_DRAFT(draftId), { method: 'DELETE' });
}

export async function deleteDraftAttachment(draftId: string, attachmentId: string): Promise<void> {
  await apiClient<void>(API.OUTBOUND.DELETE_ATTACHMENT(draftId, attachmentId), { method: 'DELETE' });
}

// ── Send ─────────────────────────────────────────────────────────

export async function sendDraft(
  draftId: string,
  recipientOverride?: string,
): Promise<OutboundMessage> {
  return apiClient<OutboundMessage>(API.OUTBOUND.SEND_DRAFT(draftId), {
    method: 'POST',
    body: recipientOverride ? { recipientOverride } : {},
  });
}

// ── History & Retry ──────────────────────────────────────────────

export async function getOutboundMessages(
  enquiryId: string,
  opts?: { limit?: number; offset?: number },
): Promise<OutboundMessagesResponse> {
  return apiClient<OutboundMessagesResponse>(API.OUTBOUND.MESSAGES(enquiryId), {
    params: {
      limit: opts?.limit,
      offset: opts?.offset,
    },
  });
}

export async function retryMessage(messageId: string): Promise<{ queued: boolean }> {
  return apiClient<{ queued: boolean }>(API.OUTBOUND.RETRY(messageId), { method: 'POST' });
}
