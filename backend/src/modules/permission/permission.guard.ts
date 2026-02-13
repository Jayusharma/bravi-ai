import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, RequiredPermission } from './permission.decorator';
import { PermissionService } from './permission.service';

/**
 * PermissionGuard — checks DB-driven permissions.
 *
 * Replaces the old RolesGuard. Instead of checking hardcoded role arrays,
 * it reads from the Permission + RolePermission tables (cached in memory).
 *
 * If no @CheckPermission() decorator is present on the route, the guard
 * allows access (only JWT auth is enforced).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private permissionService: PermissionService,
    ) { }

    canActivate(ctx: ExecutionContext): boolean {
        // 1. Get the required permission from the decorator metadata
        const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission>(
            PERMISSION_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );

        // No @CheckPermission() → allow (auth is handled by JwtAuthGuard)
        if (!requiredPermission) return true;

        // 2. Get the authenticated user from the request
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new ForbiddenException('Authentication required');
        }

        // 3. Check permission via the cached permission service
        const hasPermission = this.permissionService.hasPermission(
            user.role,
            requiredPermission.action,
            requiredPermission.subject,
            { userId: user.userId },
        );

        if (!hasPermission) {
            throw new ForbiddenException(
                `You do not have permission to ${requiredPermission.action} ${requiredPermission.subject}`,
            );
        }

        return true;
    }
}
