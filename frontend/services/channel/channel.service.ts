'use server';

import { apiClient, ApiError, getErrorLabel } from '@/lib/api-client';
import { API } from '@/lib/endpoints';
import type { ServiceResult } from '@/lib/error';

// ═══════════════════════════════════════════════════════════════════
// TYPES — mirror the backend's ChannelConnection + MaskedChannelConnection
// (backend/src/modules/channels/channels.service.ts). The raw API key never
// crosses this boundary — only `apiKeyMasked` (e.g. "••••9f2a").
// ═══════════════════════════════════════════════════════════════════

export type ChannelProvider = 'SENDGRID_EMAIL' | 'META_WHATSAPP' | 'TWILIO_WHATSAPP';
export type ChannelType = 'EMAIL' | 'WHATSAPP' | 'SMS'; // mirrors Prisma MessageChannel
export type ConnectionStatus = 'ACTIVE' | 'DISABLED';

export interface ChannelConnection {
    id: string;
    provider: ChannelProvider;
    channel: ChannelType;
    displayName: string;
    status: ConnectionStatus;
    externalAccountId: string; // from-email (SendGrid) / Phone Number ID (Meta WhatsApp)
    apiKeyMasked: string;
    lastInboundAt: string | null;
    lastError: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

/** Body for POST /channels — the "Add Channel" modal, Connect button.
 *  Provider-specific fields (backend asserts the required set per provider):
 *  SENDGRID_EMAIL → apiKey + fromEmail · META_WHATSAPP → phoneNumberId + accessToken + verifyToken */
export interface CreateChannelInput {
    provider: ChannelProvider;
    displayName: string;
    // SendGrid (email)
    apiKey?: string;
    fromEmail?: string;
    // Meta WhatsApp (Cloud API)
    phoneNumberId?: string;
    accessToken?: string;
    verifyToken?: string;
}

/** Body for PATCH /channels/:id — rename, or rotate the key/from-email. All optional. */
export interface UpdateChannelInput {
    displayName?: string;
    apiKey?: string;
    fromEmail?: string;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — ServiceResult wrappers (mirrors services/template)
// ═══════════════════════════════════════════════════════════════════

function createSuccess<T>(data: T): ServiceResult<T> {
    return { success: true, data, error: null };
}

function createError<T>(error: unknown): ServiceResult<T> {
    if (error instanceof ApiError) {
        const label = getErrorLabel(error.type);
        const details = error.details?.length ? ` (${error.details.join(', ')})` : '';
        return { success: false, data: null, error: `${label}: ${error.message}${details}` };
    }
    if (error instanceof Error) {
        return { success: false, data: null, error: error.message };
    }
    return { success: false, data: null, error: 'An unexpected error occurred.' };
}

// ═══════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════

export async function listChannels(): Promise<ServiceResult<ChannelConnection[]>> {
    try {
        const data = await apiClient<ChannelConnection[]>(API.CHANNEL.LIST);
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

// ═══════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════

export async function createChannel(
    input: CreateChannelInput,
): Promise<ServiceResult<ChannelConnection>> {
    try {
        const data = await apiClient<ChannelConnection>(API.CHANNEL.CREATE, {
            method: 'POST',
            body: { ...input },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function updateChannel(
    id: string,
    input: UpdateChannelInput,
): Promise<ServiceResult<ChannelConnection>> {
    try {
        const data = await apiClient<ChannelConnection>(API.CHANNEL.UPDATE(id), {
            method: 'PATCH',
            body: { ...input },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

/** The on/off toggle. */
export async function updateChannelStatus(
    id: string,
    status: ConnectionStatus,
): Promise<ServiceResult<ChannelConnection>> {
    try {
        const data = await apiClient<ChannelConnection>(API.CHANNEL.STATUS(id), {
            method: 'PATCH',
            body: { status },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function deleteChannel(id: string): Promise<ServiceResult<void>> {
    try {
        await apiClient<void>(API.CHANNEL.DELETE(id), { method: 'DELETE' });
        return createSuccess(undefined as void);
    } catch (error) {
        return createError(error);
    }
}
