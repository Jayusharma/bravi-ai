import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { CheckPermission } from './permission.decorator';
import { PermissionGuard } from './permission.guard';
import { UserRole } from '@prisma/client';
import { IsEnum, IsString, IsOptional, IsUUID } from 'class-validator';

// ─── DTOs ────────────────────────────────────────────────────────────────

class GrantPermissionDto {
    @IsEnum(UserRole)
    role: UserRole;

    @IsUUID()
    permissionId: string;

    @IsOptional()
    conditions?: any;
}

// ─── Controller ──────────────────────────────────────────────────────────

@Controller('permissions')
export class PermissionController {
    constructor(private permissionService: PermissionService) { }

    /**
     * GET /permissions — List all permissions with their role mappings.
     * Admin only.
     */
    @Get()
    @UseGuards(PermissionGuard)
    @CheckPermission({ action: 'manage', subject: 'all' })
    getAllPermissions() {
        return this.permissionService.getAllPermissions();
    }

    /**
     * GET /permissions/role/:role — List permissions for a specific role.
     * Admin only.
     */
    @Get('role/:role')
    @UseGuards(PermissionGuard)
    @CheckPermission({ action: 'manage', subject: 'all' })
    getRolePermissions(@Param('role') role: UserRole) {
        return this.permissionService.getRolePermissions(role);
    }

    /**
     * POST /permissions/grant — Grant a permission to a role.
     * Admin only.
     */
    @Post('grant')
    @UseGuards(PermissionGuard)
    @CheckPermission({ action: 'manage', subject: 'all' })
    grantPermission(@Body() dto: GrantPermissionDto) {
        return this.permissionService.grantPermission(dto.role, dto.permissionId, dto.conditions);
    }

    /**
     * DELETE /permissions/revoke/:id — Revoke a role permission by its ID.
     * Admin only.
     */
    @Delete('revoke/:id')
    @UseGuards(PermissionGuard)
    @CheckPermission({ action: 'manage', subject: 'all' })
    revokePermission(@Param('id') id: string) {
        return this.permissionService.revokePermission(id);
    }

    /**
     * POST /permissions/reload — Force reload the permission cache.
     * Admin only. Useful after direct DB edits.
     */
    @Post('reload')
    @UseGuards(PermissionGuard)
    @CheckPermission({ action: 'manage', subject: 'all' })
    async reloadCache() {
        await this.permissionService.loadPermissions();
        return { message: 'Permission cache reloaded' };
    }
}
