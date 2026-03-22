import { IsOptional, IsEnum, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateRolePermissionDto {
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @IsOptional()
    @IsString()
    permissionId?: string;

    @IsOptional()
    conditions?: Record<string, any>;
}
