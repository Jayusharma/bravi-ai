import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdatePermissionDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    action?: string;

    @IsOptional()
    @IsString()
    @MinLength(2)
    subject?: string;
}
