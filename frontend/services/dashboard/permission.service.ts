'use server';

import { revalidatePath } from 'next/cache';
import { apiClient, ApiError, getErrorLabel } from '@/lib/api-client';
import { API } from '@/lib/endpoints';
import type { AppRole } from '@/lib/roles';
import type { ServiceResult } from '@/lib/error';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PermissionRecord {
    id: string;
    action: string;
    subject: string;
    _count?: {
        rolePermissions: number;
    };
}

export interface RolePermissionRecord {
    id: string;
    role: AppRole;
    permissionId: string;
    conditions: Record<string, unknown> | null;
    createdAt: string;
    permission: {
        id: string;
        action: string;
        subject: string;
    };
}

export interface PermissionEntry {
    permissionId: string;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
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
// SERVICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

export async function getPermissions(): Promise<ServiceResult<PermissionRecord[]>> {
    try {
        const data = await apiClient<PermissionRecord[]>(API.PERMISSION.LIST);
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function getRoleAssignments(): Promise<ServiceResult<RolePermissionRecord[]>> {
    try {
        const data = await apiClient<RolePermissionRecord[]>(API.PERMISSION.ROLE_ASSIGNMENTS);
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function createCustomPermission(
    input: { action: string; subject: string },
): Promise<ServiceResult<PermissionRecord>> {
    try {
        const data = await apiClient<PermissionRecord>(API.PERMISSION.CREATE, {
            method: 'POST',
            body: input,
        });
        revalidatePath('/permissions');
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function createSubjectBundle(subject: string): Promise<ServiceResult<unknown>> {
    try {
        const data = await apiClient(API.PERMISSION.SUBJECTS, {
            method: 'POST',
            body: { subject },
        });
        revalidatePath('/permissions');
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function updatePermission(
    permissionId: string,
    input: { action?: string; subject?: string },
): Promise<ServiceResult<PermissionRecord>> {
    try {
        const data = await apiClient<PermissionRecord>(API.PERMISSION.UPDATE(permissionId), {
            method: 'PATCH',
            body: input,
        });
        revalidatePath('/permissions');
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function deletePermission(permissionId: string): Promise<ServiceResult<{ message: string }>> {
    try {
        const data = await apiClient<{ message: string }>(API.PERMISSION.DELETE(permissionId), {
            method: 'DELETE',
        });
        revalidatePath('/permissions');
        return createSuccess(data);
    } catch (error) {
        return createError(error);
    }
}

export async function saveRolePermissions(
    role: AppRole,
    entries: PermissionEntry[],
): Promise<ServiceResult<void>> {
    try {
        await apiClient(API.PERMISSION.ROLE_CLEAR(role), {
            method: 'DELETE',
        });

        if (entries.length > 0) {
            await apiClient(API.PERMISSION.ROLE_BULK_ASSIGN, {
                method: 'POST',
                body: {
                    role,
                    permissions: entries,
                },
            });
        }

        revalidatePath('/permissions');
        return createSuccess<void>(undefined);
    } catch (error) {
        return createError(error);
    }
}
