import { IsEnum, IsOptional, IsString, IsInt, IsUUID, MinLength, IsArray } from 'class-validator';
import { EnquirySource, EnquiryStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateEnquiryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(EnquirySource)
  source: EnquirySource;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ChangeStatusDto {
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;

  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  lostReason?: string; // Required when status = CLOSED_LOST
}

export class AssignEnquiryDto {
  @IsUUID()
  userId: string;

  @IsInt()
  version: number;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content: string;
}
