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
  sentByUser: { id: string; displayName: string | null; userName: string } | null;
};

// ── This matches EXACTLY what the backend returns from getThread() ──
//
// Backend shape:
//   {
//     contact: { id, displayName, organization, channels },
//     enquiries: [                          ← ARRAY (one per conversation)
//       {
//         enquiryId, status, type, intent, tags, assignedTo,
//         messageCount, createdAt, lastActivityAt,
//         messages: [ ...ThreadMessage ]   ← each enquiry has its own messages
//       }
//     ]
//   }

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
  enquiries: EnquiryThread[]; // ← ARRAY, not a single object
};

export type ConversationsResponse = {
  data: ConversationPreview[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export async function getConversations(params?: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<ConversationsResponse> {
  return apiClient<ConversationsResponse>(API.CONVERSATION.LIST, { params });
}

// Takes contactId — returns all enquiries for that contact, each with messages
export async function getConversationThread(contactId: string): Promise<ConversationThread> {
  return apiClient<ConversationThread>(API.CONVERSATION.THREAD(contactId));
}
