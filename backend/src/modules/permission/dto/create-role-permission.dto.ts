import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateRolePermissionDto {
    @IsEnum(UserRole)
    role: UserRole;

    @IsString()
    @IsNotEmpty()
    permissionId: string;

    @IsOptional()
    conditions?: Record<string, any>; // CASL conditions like { assignedToId: "$userId" }
}
