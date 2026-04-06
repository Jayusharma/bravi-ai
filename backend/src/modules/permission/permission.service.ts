import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { BulkAssignRolePermissionDto } from './dto/bulk-assign-role-permission.dto';
import { CreateSubjectBundleDto } from './dto/create-subject-bundle.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class PermissionService {
    constructor(private prisma: PrismaService) { }

    private readonly defaultSubjectActions = ['create', 'read', 'update', 'delete'] as const;

    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSION CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a new permission (action + subject pair).
     * Throws ConflictException if the same action+subject already exists.
     */
    async createPermission(dto: CreatePermissionDto) {
        // Auto-lowercase for consistency — no more case mismatch bugs
        const action = dto.action.toLowerCase();
        const subject = dto.subject.toLowerCase();

        const existing = await this.prisma.permission.findUnique({
            where: {
                action_subject: { action, subject },
            },
        });

        if (existing) {
            throw new ConflictException(
                `Permission "${action}" on "${subject}" already exists`,
            );
        }

        return this.prisma.permission.create({
            data: { action, subject },
        });
    }

    /**
     * Create a subject and automatically provision CRUD permissions for it.
     * Accepts optional actions override, but defaults to create/read/update/delete.
     */
    async createSubjectBundle(dto: CreateSubjectBundleDto) {
        const subject = dto.subject.toLowerCase().trim();
        const actions = (dto.actions?.length ? dto.actions : [...this.defaultSubjectActions])
            .map((action) => action.toLowerCase().trim())
            .filter(Boolean);

        if (!subject) {
            throw new BadRequestException('Subject is required');
        }

        const uniqueActions = Array.from(new Set(actions));
        if (uniqueActions.length === 0) {
            throw new BadRequestException('At least one action is required');
        }

        const created: Array<{ id: string; action: string; subject: string }> = [];
        const skipped: Array<{ action: string; subject: string; reason: string }> = [];

        for (const action of uniqueActions) {
            const existing = await this.prisma.permission.findUnique({
                where: {
                    action_subject: { action, subject },
                },
            });

            if (existing) {
                skipped.push({ action, subject, reason: 'Already exists' });
                continue;
            }

            const permission = await this.prisma.permission.create({
                data: { action, subject },
            });

            created.push(permission);
        }

        return {
            subject,
            created,
            skipped,
            summary: `${created.length} created, ${skipped.length} skipped`,
        };
    }

    /**
     * List all permissions, ordered alphabetically by subject then action.
     */
    async findAllPermissions() {
        return this.prisma.permission.findMany({
            orderBy: [{ subject: 'asc' }, { action: 'asc' }],
            include: {
                _count: {
                    select: { rolePermissions: true },
                },
            },
        });
    }

    /**
     * Get a single permission by ID.
     */
    async findPermissionById(id: string) {
        const permission = await this.prisma.permission.findUnique({
            where: { id },
            include: {
                rolePermissions: {
                    select: {
                        id: true,
                        role: true,
                        conditions: true,
                        createdAt: true,
                    },
                },
            },
        });

        if (!permission) {
            throw new NotFoundException(`Permission with ID "${id}" not found`);
        }

        return permission;
    }

    /**
     * Update a permission's action or subject.
     */
    async updatePermission(id: string, dto: UpdatePermissionDto) {
        const permission = await this.prisma.permission.findUnique({
            where: { id },
        });

        if (!permission) {
            throw new NotFoundException(`Permission with ID "${id}" not found`);
        }

        // Auto-lowercase for consistency
        const newAction = dto.action?.toLowerCase() ?? permission.action;
        const newSubject = dto.subject?.toLowerCase() ?? permission.subject;

        if (newAction !== permission.action || newSubject !== permission.subject) {
            const conflict = await this.prisma.permission.findUnique({
                where: {
                    action_subject: { action: newAction, subject: newSubject },
                },
            });

            if (conflict && conflict.id !== id) {
                throw new ConflictException(
                    `Permission "${newAction}" on "${newSubject}" already exists`,
                );
            }
        }

        return this.prisma.permission.update({
            where: { id },
            data: {
                ...(dto.action && { action: newAction }),
                ...(dto.subject && { subject: newSubject }),
            },
        });
    }

    /**
     * Delete a permission. Cascading delete removes all role assignments too.
     */
    async deletePermission(id: string) {
        const permission = await this.prisma.permission.findUnique({
            where: { id },
        });

        if (!permission) {
            throw new NotFoundException(`Permission with ID "${id}" not found`);
        }

        await this.prisma.permission.delete({ where: { id } });

        return { message: `Permission "${permission.action}:${permission.subject}" deleted successfully` };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ROLE PERMISSION CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Assign a permission to a role.
     * Throws ConflictException if the role already has this permission.
     */
    async createRolePermission(dto: CreateRolePermissionDto) {
        // Verify permission exists
        const permission = await this.prisma.permission.findUnique({
            where: { id: dto.permissionId },
        });

        if (!permission) {
            throw new NotFoundException(
                `Permission with ID "${dto.permissionId}" not found`,
            );
        }

        // Check for duplicate assignment
        const existing = await this.prisma.rolePermission.findUnique({
            where: {
                role_permissionId: {
                    role: dto.role,
                    permissionId: dto.permissionId,
                },
            },
        });

        if (existing) {
            throw new ConflictException(
                `Role "${dto.role}" already has permission "${permission.action}:${permission.subject}"`,
            );
        }

        return this.prisma.rolePermission.create({
            data: {
                role: dto.role,
                permissionId: dto.permissionId,
                conditions: dto.conditions ?? undefined,
            },
            include: {
                permission: true,
            },
        });
    }

    /**
     * List all role-permission assignments.
     * Optionally filter by role.
     */
    async findAllRolePermissions(role?: UserRole) {
        return this.prisma.rolePermission.findMany({
            where: role ? { role } : undefined,
            include: {
                permission: true,
            },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        });
    }

    /**
     * Get all permissions for a specific role.
     * Returns grouped data with role name and flat permission list.
     */
    async findPermissionsByRole(role: UserRole) {
        const rolePermissions = await this.prisma.rolePermission.findMany({
            where: { role },
            include: { permission: true },
            orderBy: { createdAt: 'asc' },
        });

        return {
            role,
            totalPermissions: rolePermissions.length,
            permissions: rolePermissions.map((rp) => ({
                id: rp.id,
                permissionId: rp.permission.id,
                action: rp.permission.action,
                subject: rp.permission.subject,
                conditions: rp.conditions,
                createdAt: rp.createdAt,
            })),
        };
    }

    /**
     * Get a single role-permission assignment by ID.
     */
    async findRolePermissionById(id: string) {
        const rolePermission = await this.prisma.rolePermission.findUnique({
            where: { id },
            include: { permission: true },
        });

        if (!rolePermission) {
            throw new NotFoundException(
                `Role permission with ID "${id}" not found`,
            );
        }

        return rolePermission;
    }

    /**
     * Update a role-permission (change conditions, role, or associated permission).
     */
    async updateRolePermission(id: string, dto: UpdateRolePermissionDto) {
        const existing = await this.prisma.rolePermission.findUnique({
            where: { id },
        });

        if (!existing) {
            throw new NotFoundException(
                `Role permission with ID "${id}" not found`,
            );
        }

        // If changing permissionId, verify it exists
        if (dto.permissionId) {
            const permission = await this.prisma.permission.findUnique({
                where: { id: dto.permissionId },
            });
            if (!permission) {
                throw new NotFoundException(
                    `Permission with ID "${dto.permissionId}" not found`,
                );
            }
        }

        // Check for duplicate if role or permissionId is changing
        const newRole = dto.role ?? existing.role;
        const newPermissionId = dto.permissionId ?? existing.permissionId;

        if (newRole !== existing.role || newPermissionId !== existing.permissionId) {
            const conflict = await this.prisma.rolePermission.findUnique({
                where: {
                    role_permissionId: {
                        role: newRole,
                        permissionId: newPermissionId,
                    },
                },
            });

            if (conflict && conflict.id !== id) {
                throw new ConflictException(
                    `Role "${newRole}" already has this permission assigned`,
                );
            }
        }

        return this.prisma.rolePermission.update({
            where: { id },
            data: {
                ...(dto.role && { role: dto.role }),
                ...(dto.permissionId && { permissionId: dto.permissionId }),
                ...(dto.conditions !== undefined && { conditions: dto.conditions }),
            },
            include: { permission: true },
        });
    }

    /**
     * Remove a permission assignment from a role.
     */
    async deleteRolePermission(id: string) {
        const rolePermission = await this.prisma.rolePermission.findUnique({
            where: { id },
            include: { permission: true },
        });

        if (!rolePermission) {
            throw new NotFoundException(
                `Role permission with ID "${id}" not found`,
            );
        }

        await this.prisma.rolePermission.delete({ where: { id } });

        return {
            message: `Permission "${rolePermission.permission.action}:${rolePermission.permission.subject}" removed from role "${rolePermission.role}"`,
        };
    }

    /**
     * Bulk assign multiple permissions to a role.
     * Skips duplicates and returns what was created.
     */
    async bulkAssignRolePermissions(dto: BulkAssignRolePermissionDto) {
        const results = {
            created: [] as any[],
            skipped: [] as any[],
        };

        for (const entry of dto.permissions) {
            // Verify permission exists
            const permission = await this.prisma.permission.findUnique({
                where: { id: entry.permissionId },
            });

            if (!permission) {
                results.skipped.push({
                    permissionId: entry.permissionId,
                    reason: 'Permission not found',
                });
                continue;
            }

            // Check for existing assignment
            const existing = await this.prisma.rolePermission.findUnique({
                where: {
                    role_permissionId: {
                        role: dto.role,
                        permissionId: entry.permissionId,
                    },
                },
            });

            if (existing) {
                results.skipped.push({
                    permissionId: entry.permissionId,
                    action: permission.action,
                    subject: permission.subject,
                    reason: 'Already assigned',
                });
                continue;
            }

            const created = await this.prisma.rolePermission.create({
                data: {
                    role: dto.role,
                    permissionId: entry.permissionId,
                    conditions: entry.conditions ?? undefined,
                },
                include: { permission: true },
            });

            results.created.push(created);
        }

        return {
            role: dto.role,
            ...results,
            summary: `${results.created.length} assigned, ${results.skipped.length} skipped`,
        };
    }

    /**
     * Remove ALL permissions from a role.
     * Useful for resetting a role's permissions before bulk re-assignment.
     */
    async clearRolePermissions(role: UserRole) {
        const deleted = await this.prisma.rolePermission.deleteMany({
            where: { role },
        });

        return {
            message: `Cleared ${deleted.count} permissions from role "${role}"`,
            count: deleted.count,
        };
    }
}
