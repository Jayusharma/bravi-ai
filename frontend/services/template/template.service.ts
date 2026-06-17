'use server';

import { apiClient, ApiError, getErrorLabel } from '@/lib/api-client';
import { API } from '@/lib/endpoints';
import type { ServiceResult } from '@/lib/error';

// ═══════════════════════════════════════════════════════════════════
// TYPES — these ARE the API contract the backend (Step 3) must satisfy.
// Enums mirror Prisma (@prisma/client) as string unions.
// ═══════════════════════════════════════════════════════════════════

export type TemplateType = 'INTERNAL' | 'WHATSAPP';
export type TemplateChannel = 'WHATSAPP' | 'EMAIL'; // MessageChannel also has SMS; templates don't use it
export type WaContentType = 'TEXT' | 'MEDIA' | 'CALL_TO_ACTION' | 'QUICK_REPLY';
export type WaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WaApprovalStatus =
    | 'DRAFT'
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'PAUSED'
    | 'DISABLED';
export type VariableType = 'SYSTEM' | 'CUSTOM';

export interface TemplateVariable {
    id: string;
    position: number;
    label: string;
    source: string;
    type: VariableType;
}

export interface Template {
    id: string;
    type: TemplateType;
    name: string;
    friendlyName: string;
    channel: TemplateChannel;
    language: string;

    body: string;
    bodyCompiled: string | null;
    subject: string | null;
    contentType: WaContentType;
    buttons: Record<string, unknown> | null;
    headerMediaUrl: string | null;

    contentSid: string | null;
    category: WaTemplateCategory | null;
    approvalStatus: WaApprovalStatus | null;
    rejectionReason: string | null;
    sampleValues: Record<string, string> | null;

    isActive: boolean;
    createdBy: string;
    createdAt: string;
    updatedAt: string;

    variables: TemplateVariable[];
}

/** Suggestion row for the custom-variable autocomplete. */
export interface VariableSuggestion {
    label: string;
    source: string;
    type: VariableType;
}

/** A variable with its value resolved against a live conversation (null = agent must fill). */
export interface ResolvedVariable {
    label: string;
    source: string;
    type: VariableType;
    value: string | null;
}

/** A template usable in a conversation: the template plus its pre-resolved variables. */
export interface UsableTemplate extends Template {
    resolvedVariables: ResolvedVariable[];
}

export interface PaginatedTemplates {
    data: Template[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface ListTemplatesFilters {
    filter_by_template?: TemplateType | 'ALL';
    filter_by_channel?: TemplateChannel | 'ALL';
    search?: string;
    page?: number;
    limit?: number;
}

/** Body for POST /templates. Mirrors CreateTemplateDto. */
export interface CreateTemplateInput {
    type: TemplateType;
    name: string;
    friendlyName: string;
    channel: TemplateChannel;
    language?: string;
    body: string;
    subject?: string;
    contentType?: WaContentType;
    buttons?: Record<string, unknown>;
    headerMediaUrl?: string;
    category?: WaTemplateCategory;
    sampleValues?: Record<string, string>;
    isActive?: boolean;
}

/** Body for PATCH /templates/:id. All fields optional. */
export type UpdateTemplateInput = Partial<CreateTemplateInput>;

// ═══════════════════════════════════════════════════════════════════
// HELPERS — ServiceResult wrappers (mirrors services/permissions)
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
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function listTemplates(
    filters: ListTemplatesFilters = {},
): Promise<ServiceResult<PaginatedTemplates>> {
    try {
        const data = await apiClient<PaginatedTemplates>(API.TEMPLATE.LIST, {
            params: {
                filter_by_template: filters.filter_by_template === 'ALL' ? undefined : filters.filter_by_template,
                filter_by_channel: filters.filter_by_channel === 'ALL' ? undefined : filters.filter_by_channel,
                search: filters.search || undefined,
                page: filters.page,
                limit: filters.limit,
            },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function getTemplate(id: string): Promise<ServiceResult<Template>> {
    try {
        return createSuccess(await apiClient<Template>(API.TEMPLATE.DETAIL(id)));
    } catch (error) {
        return createError(error);
    }
}

export async function getUsableTemplates(
    enquiryId: string,
    channel: TemplateChannel,
): Promise<ServiceResult<UsableTemplate[]>> {
    try {
        const data = await apiClient<UsableTemplate[]>(API.TEMPLATE.USABLE, {
            params: { enquiryId, channel },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function suggestVariables(
    q: string,
): Promise<ServiceResult<VariableSuggestion[]>> {
    try {
        const data = await apiClient<VariableSuggestion[]>(API.TEMPLATE.VARIABLES_SUGGEST, {
            params: { q },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function createTemplate(
    input: CreateTemplateInput,
): Promise<ServiceResult<Template>> {
    try {
        const data = await apiClient<Template>(API.TEMPLATE.CREATE, {
            method: 'POST',
            body: { ...input },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function updateTemplate(
    id: string,
    input: UpdateTemplateInput,
): Promise<ServiceResult<Template>> {
    try {
        const data = await apiClient<Template>(API.TEMPLATE.UPDATE(id), {
            method: 'PATCH',
            body: { ...input },
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function deleteTemplate(id: string): Promise<ServiceResult<void>> {
    try {
        await apiClient<void>(API.TEMPLATE.DELETE(id), { method: 'DELETE' });
        return createSuccess(undefined as void);
    } catch (error) {
        return createError(error);
    }
}

export async function duplicateTemplate(id: string): Promise<ServiceResult<Template>> {
    try {
        const data = await apiClient<Template>(API.TEMPLATE.DUPLICATE(id), {
            method: 'POST',
        });
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}
