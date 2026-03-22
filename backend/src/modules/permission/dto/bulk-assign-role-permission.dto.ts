import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';

class PermissionEntry {
    @IsString()
    @IsNotEmpty()
    permissionId: string;

    @IsOptional()
    conditions?: Record<string, any>;
}

export class BulkAssignRolePermissionDto {
    @IsEnum(UserRole)
    role: UserRole;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PermissionEntry)
    permissions: PermissionEntry[];
}
