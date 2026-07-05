'use server';

import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface EnquiryListItem {
    id: string;
    type: string;
    status: string;
    tags: string[];
    intent: string | null;
    urgency: number | null;
    priority: number | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
    lastCustomerReplyAt: string | null;
    contactId: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    source: string;
    assignedTo: { id: string; displayName: string | null; userName: string } | null;
    messageCount: number;
    noteCount: number;
    lastMessagePreview: string | null;
    lastMessageSender: string | null;
}

export interface EnquiryListResponse {
    items: EnquiryListItem[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface EnquiryDetail {
    id: string;
    type: string;
    status: string;
    tags: string[];
    intent: string | null;
    urgency: number | null;
    priority: number | null;
    version: number;
    lostReason: string | null;
    lastCustomerReplyAt: string | null;
    firstResponseAt: string | null;
    lastActivityAt: string;
    createdAt: string;
    updatedAt: string;
    assignedToId: string | null;
    contact: {
        id: string;
        displayName: string;
        organization: string | null;
        channels: Array<{ id: string; channel: string; identifier: string; isPrimary: boolean }>;
    };
    assignedTo: { id: string; displayName: string | null; userName: string } | null;
    messages: Array<{
        id: string;
        channel: string;
        direction: string;
        from: string;
        to: string | null;
        content: string;
        deliveryStatus: string;
        createdAt: string;
        sentByUser: { id: string; displayName: string | null; userName: string } | null;
    }>;
    timeline: Array<{
        id: string;
        type: string;
        fromStatus: string | null;
        toStatus: string | null;
        metadata: Record<string, unknown> | null;
        createdBy: string | null;
        createdAt: string;
    }>;
    notes: Array<{
        id: string;
        content: string;
        createdBy: string;
        createdAt: string;
    }>;
}

export interface EnquiryStats {
    byStatus: Record<string, number>;
    unassigned: number;
    totalOpen: number;
    kpis: {
        all: number;
        new: number;
        inProgress: number;
        followUp: number;
        converted: number;
        closedLost: number;
        newThisWeek: number;
    };
    overview: {
        total: number;
        byStatus: Record<string, number>;
        changeVsLastMonth: number;
    };
    sourceBreakdown: Array<{ source: string; count: number; percentage: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function getEnquiries(filters?: {
    status?: string;
    source?: string;
    search?: string;
    assignedToId?: string;
    page?: number;
    limit?: number;
}): Promise<EnquiryListResponse> {
    return apiClient<EnquiryListResponse>(API.ENQUIRY.LIST, {
        params: {
            status: filters?.status,
            source: filters?.source,
            search: filters?.search,
            assignedToId: filters?.assignedToId,
            page: filters?.page,
            limit: filters?.limit,
        },
    });
}

export async function getEnquiry(id: string): Promise<EnquiryDetail> {
    return apiClient<EnquiryDetail>(API.ENQUIRY.DETAIL(id));
}

export async function getEnquiryStats(): Promise<EnquiryStats> {
    return apiClient<EnquiryStats>(API.ENQUIRY.STATS);
}

export interface PaginatedMessagesResponse {
    data: EnquiryDetail['messages'];
    cursor: string | null;
    hasMore: boolean;
}

export async function getMessages(
    id: string,
    params?: { cursor?: string; limit?: number }
): Promise<PaginatedMessagesResponse> {
    return apiClient<PaginatedMessagesResponse>(API.ENQUIRY.MESSAGES(id), {
        params: {
            cursor: params?.cursor,
            limit: params?.limit,
        },
    });
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS (Mutations)
// ═══════════════════════════════════════════════════════════════════

export async function createEnquiry(data: {
    contactId: string;
    type?: string;
    tags?: string[];
    initialMessage?: string;
}) {
    return apiClient(API.ENQUIRY.CREATE, {
        method: 'POST',
        body: data,
    });
}

export async function changeStatus(
    id: string,
    status: string,
    version: number,
    lostReason?: string,
) {
    return apiClient(API.ENQUIRY.STATUS(id), {
        method: 'PATCH',
        body: { status, version, lostReason },
    });
}

export async function assignEnquiry(id: string, userId: string, version: number) {
    return apiClient(API.ENQUIRY.ASSIGN(id), {
        method: 'PATCH',
        body: { userId, version },
    });
}

export async function updateTags(id: string, tags: string[]) {
    return apiClient(API.ENQUIRY.TAGS(id), {
        method: 'PATCH',
        body: { tags },
    });
}

export async function sendMessage(id: string, content: string, channel?: string) {
    return apiClient(API.ENQUIRY.MESSAGES(id), {
        method: 'POST',
        body: { content, channel },
    });
}

export async function addNote(id: string, content: string) {
    return apiClient(API.ENQUIRY.NOTES(id), {
        method: 'POST',
        body: { content },
    });
}

export async function deleteEnquiry(id: string) {
    return apiClient(API.ENQUIRY.DETAIL(id), {
        method: 'DELETE',
    });
}

export async function bulkDeleteEnquiries(ids: string[]) {
    return apiClient(API.ENQUIRY.BULK_DELETE, {
        method: 'POST',
        body: { ids },
    });
}
