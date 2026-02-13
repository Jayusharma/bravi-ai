import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UserRole } from '@prisma/client';

/**
 * PermissionService — reads permissions from the database.
 * Caches them in-memory on startup and provides a manual refresh.
 *
 * This is the core of the DB-driven permission system:
 * - Permissions are stored in `Permission` + `RolePermission` tables.
 * - Admin manages them via API (or directly in DB / seed).
 * - The PermissionGuard uses this service to check access.
 */

export interface CachedPermission {
    action: string;
    subject: string;
    conditions: any | null;
}

@Injectable()
export class PermissionService implements OnModuleInit {
    // In-memory cache: role → list of permissions
    private cache: Map<UserRole, CachedPermission[]> = new Map();

    constructor(private prisma: PrismaService) { }

    /**
     * Load all permissions into memory on app startup.
     */
    async onModuleInit() {
        await this.loadPermissions();
    }

    /**
     * Load permissions from DB into the in-memory cache.
     * Call this after creating/updating/deleting role permissions.
     *
     * Gracefully handles the case where tables don't exist yet
     * (e.g., before the first migration has been run).
     */
    async loadPermissions() {
        try {
            const rolePermissions = await this.prisma.rolePermission.findMany({
                include: { permission: true },
            });

            const newCache = new Map<UserRole, CachedPermission[]>();

            for (const rp of rolePermissions) {
                const role = rp.role;
                if (!newCache.has(role)) {
                    newCache.set(role, []);
                }
                newCache.get(role)!.push({
                    action: rp.permission.action,
                    subject: rp.permission.subject,
                    conditions: rp.conditions,
                });
            }

            this.cache = newCache;
            console.log(`✅ Permissions loaded: ${rolePermissions.length} rules for ${newCache.size} roles`);
        } catch (error: any) {
            // Table may not exist yet (before migration). Don't crash the app.
            console.warn(`⚠️  Could not load permissions: ${error?.meta?.modelName || error.message}`);
            console.warn(`   Run migrations and seed:permissions to set up the permission tables.`);
            this.cache = new Map();
        }
    }

    /**
     * Check if a role has permission to perform an action on a subject.
     * Supports wildcard "manage" action and "all" subject.
     * Supports conditions like { assignedToId: "$userId" }.
     */
    hasPermission(
        role: UserRole,
        action: string,
        subject: string,
        context?: { userId?: string; resource?: any },
    ): boolean {
        const permissions = this.cache.get(role);
        if (!permissions) return false;

        for (const perm of permissions) {
            // Check if action matches (exact or "manage" wildcard)
            const actionMatch = perm.action === action || perm.action === 'manage';

            // Check if subject matches (exact or "all" wildcard)
            const subjectMatch = perm.subject === subject || perm.subject === 'all';

            if (actionMatch && subjectMatch) {
                // No conditions → direct match
                if (!perm.conditions) return true;

                // Has conditions → evaluate them
                if (context?.resource && this.evaluateConditions(perm.conditions, context)) {
                    return true;
                }

                // Has conditions but no resource context → allow (guard will do fine-grained check at service level)
                if (!context?.resource) return true;
            }
        }

        return false;
    }

    /**
     * Evaluate conditions against the resource and user context.
     * e.g., conditions = { "assignedToId": "$userId" }
     * Replaces "$userId" with the actual userId from context.
     */
    private evaluateConditions(
        conditions: Record<string, any>,
        context: { userId?: string; resource?: any },
    ): boolean {
        for (const [field, expectedValue] of Object.entries(conditions)) {
            let resolvedValue = expectedValue;

            // Replace special placeholders
            if (resolvedValue === '$userId') {
                resolvedValue = context.userId;
            }

            const actualValue = context.resource?.[field];
            if (actualValue !== resolvedValue) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get all permissions for a specific role (for sending to frontend).
     */
    getPermissionsForRole(role: UserRole): CachedPermission[] {
        return this.cache.get(role) || [];
    }

    /**
     * Get all permissions and role mappings (for admin management UI).
     */
    async getAllPermissions() {
        return this.prisma.permission.findMany({
            include: {
                rolePermissions: true,
            },
            orderBy: [{ subject: 'asc' }, { action: 'asc' }],
        });
    }

    /**
     * Get role permissions grouped by role (for admin management UI).
     */
    async getRolePermissions(role: UserRole) {
        return this.prisma.rolePermission.findMany({
            where: { role },
            include: { permission: true },
        });
    }

    /**
     * Grant a permission to a role.
     */
    async grantPermission(role: UserRole, permissionId: string, conditions?: any) {
        const result = await this.prisma.rolePermission.create({
            data: {
                role,
                permissionId,
                conditions: conditions || undefined,
            },
            include: { permission: true },
        });

        // Reload cache after change
        await this.loadPermissions();
        return result;
    }

    /**
     * Revoke a permission from a role.
     */
    async revokePermission(rolePermissionId: string) {
        const result = await this.prisma.rolePermission.delete({
            where: { id: rolePermissionId },
        });

        // Reload cache after change
        await this.loadPermissions();
        return result;
    }
}
