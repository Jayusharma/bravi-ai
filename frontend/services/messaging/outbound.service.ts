'use server';

import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type MessageChannel = 'EMAIL' | 'WHATSAPP' | 'SMS';
export type DraftStatus = 'ACTIVE' | 'EXPIRED' | 'CLEARED';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

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
    createdAt: string;
}

export interface OutboundMessagesResponse {
    data: OutboundMessage[];
    total: number;
}

// ═══════════════════════════════════════════════════════════════════
// DRAFT CRUD
// ═══════════════════════════════════════════════════════════════════

export async function getActiveDraft(enquiryId: string): Promise<OutboundDraft | null> {
    return apiClient<OutboundDraft | null>(API.OUTBOUND.GET_DRAFT(enquiryId));
}

export async function createDraft(
    enquiryId: string,
    data: { channel: MessageChannel; subject?: string; body?: string },
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

// ═══════════════════════════════════════════════════════════════════
// SEND
// ═══════════════════════════════════════════════════════════════════

export async function sendDraft(
    draftId: string,
    recipientOverride?: string,
): Promise<OutboundMessage> {
    return apiClient<OutboundMessage>(API.OUTBOUND.SEND_DRAFT(draftId), {
        method: 'POST',
        body: recipientOverride ? { recipientOverride } : {},
    });
}

// ═══════════════════════════════════════════════════════════════════
// HISTORY & RETRY
// ═══════════════════════════════════════════════════════════════════

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
