import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { EnquiryStatus, EnquiryType } from '@prisma/client';

export class InboxQueryDto {
    @IsOptional()
    @IsEnum(EnquiryStatus)
    status?: EnquiryStatus;

    @IsOptional()
    @IsEnum(EnquiryType)
    type?: EnquiryType;

    @IsOptional()
    @IsString()
    assignedToId?: string;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    source?: string; // Channel filter: WHATSAPP, EMAIL, etc.

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @IsOptional()
    @IsString()
    sortBy?: string = 'lastActivityAt';

    @IsOptional()
    @IsEnum(['asc', 'desc'] as const)
    sortOrder?: 'asc' | 'desc' = 'desc';
}
