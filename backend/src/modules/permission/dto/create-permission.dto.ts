import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CreatePermissionDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    action: string; // "create", "read", "update", "delete", "manage", "assign", "merge"

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    subject: string; // "Enquiry", "User", "Contact", "Permission", etc.
}
