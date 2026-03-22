import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { PermissionService } from './permission.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { BulkAssignRolePermissionDto } from './dto/bulk-assign-role-permission.dto';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { UserRole } from '@prisma/client';

@Controller('permissions')
@UseGuards(CaslGuard)
export class PermissionController {
    constructor(private readonly permissionService: PermissionService) { }

    // ═══════════════════════════════════════════════════════════════════════════
    // PERMISSION CRUD — /permissions
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * POST /permissions — Create a new permission (action + subject).
     */
    @Post('create')
    @CheckAbility({ action: 'create', subject: 'permission' })
    createPermission(@Body() dto: CreatePermissionDto) {
        return this.permissionService.createPermission(dto);
    }

    /**
     * GET /permissions — List all permissions.
     */
    @Get()
    @CheckAbility({ action: 'read', subject: 'permission' })
    findAllPermissions() {
        return this.permissionService.findAllPermissions();
    }

    /**
     * GET /permissions/:id — Get a single permission with its role assignments.
     */
    @Get(':id')
    @CheckAbility({ action: 'read', subject: 'permission' })
    findPermissionById(@Param('id') id: string) {
        return this.permissionService.findPermissionById(id);
    }

    /**
     * PATCH /permissions/:id — Update a permission.
     */
    @Patch(':id')
    @CheckAbility({ action: 'update', subject: 'permission' })
    updatePermission(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
        return this.permissionService.updatePermission(id, dto);
    }

    /**
     * DELETE /permissions/:id — Delete a permission (cascades to role assignments).
     */
    @Delete(':id')
    @CheckAbility({ action: 'delete', subject: 'permission' })
    deletePermission(@Param('id') id: string) {
        return this.permissionService.deletePermission(id);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ROLE PERMISSION CRUD — /permissions/roles/*
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * POST /permissions/roles/assign — Assign a permission to a role.
     */
    @Post('roles/assign')
    // @CheckAbility({ action: 'create', subject: 'permission' })
    createRolePermission(@Body() dto: CreateRolePermissionDto) {
        return this.permissionService.createRolePermission(dto);
    }

    /**
     * POST /permissions/roles/bulk-assign — Bulk assign permissions to a role.
     */
    @Post('roles/bulk-assign')
    @CheckAbility({ action: 'create', subject: 'permission' })
    bulkAssignRolePermissions(@Body() dto: BulkAssignRolePermissionDto) {
        return this.permissionService.bulkAssignRolePermissions(dto);
    }

    /**
     * GET /permissions/roles/all — List all role-permission assignments.
     * Optional query: ?role=ADMIN
     */
    @Get('roles/all')
    @CheckAbility({ action: 'read', subject: 'permission' })
    findAllRolePermissions(@Query('role') role?: UserRole) {
        return this.permissionService.findAllRolePermissions(role);
    }

    /**
     * GET /permissions/roles/:role — Get all permissions for a specific role.
     */
    @Get('roles/:role')
    @CheckAbility({ action: 'read', subject: 'permission' })
    findPermissionsByRole(@Param('role') role: UserRole) {
        return this.permissionService.findPermissionsByRole(role);
    }

    /**
     * GET /permissions/roles/assignment/:id — Get a single role-permission.
     */
    @Get('roles/assignment/:id')
    @CheckAbility({ action: 'read', subject: 'permission' })
    findRolePermissionById(@Param('id') id: string) {
        return this.permissionService.findRolePermissionById(id);
    }

    /**
     * PATCH /permissions/roles/assignment/:id — Update a role-permission.
     */
    @Patch('roles/assignment/:id')
    @CheckAbility({ action: 'update', subject: 'permission' })
    updateRolePermission(
        @Param('id') id: string,
        @Body() dto: UpdateRolePermissionDto,
    ) {
        return this.permissionService.updateRolePermission(id, dto);
    }

    /**
     * DELETE /permissions/roles/assignment/:id — Remove a permission from a role.
     */
    @Delete('roles/assignment/:id')
    @CheckAbility({ action: 'delete', subject: 'permission' })
    deleteRolePermission(@Param('id') id: string) {
        return this.permissionService.deleteRolePermission(id);
    }

    /**
     * DELETE /permissions/roles/:role/clear — Remove ALL permissions from a role.
     */
    @Delete('roles/:role/clear')
    @CheckAbility({ action: 'delete', subject: 'permission' })
    clearRolePermissions(@Param('role') role: UserRole) {
        return this.permissionService.clearRolePermissions(role);
    }
}
