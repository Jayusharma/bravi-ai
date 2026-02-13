import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the permission decorator.
 */
export const PERMISSION_KEY = 'required_permission';

/**
 * Interface for the permission requirement.
 */
export interface RequiredPermission {
    action: string;
    subject: string;
}

/**
 * Decorator to protect endpoints with DB-driven permissions.
 *
 * Usage:
 *   @CheckPermission({ action: 'read', subject: 'enquiry' })
 *   @CheckPermission({ action: 'update', subject: 'enquiry' })
 *   @CheckPermission({ action: 'manage', subject: 'all' })  // admin-only
 */
export const CheckPermission = (permission: RequiredPermission) =>
    SetMetadata(PERMISSION_KEY, permission);
