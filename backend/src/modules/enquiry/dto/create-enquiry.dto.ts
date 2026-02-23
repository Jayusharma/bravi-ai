import {
  IsEnum, IsOptional, IsString, IsArray, IsInt, IsUUID, MinLength,
} from 'class-validator';
import { EnquiryType, EnquiryStatus, EnquiryIntent } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * Manual enquiry creation (by sales team).
 * Requires a contactId — the person must exist first.
 */
export class CreateEnquiryDto {
  @IsUUID()
  contactId: string;

  @IsOptional()
  @IsEnum(EnquiryType)
  type?: EnquiryType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  initialMessage?: string; // Optional first message content
}

export class ChangeStatusDto {
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;

  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  lostReason?: string;
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

  @IsOptional()
  @IsString()
  channel?: string; // If not specified, uses last channel customer used

  @IsOptional()
  @IsString()
  templateId?: string; // If using a canned response
}

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  content: string;
}

export class QualifiedDto {
 
   @IsUUID()
   inboundMessageId: string;
   
  @IsUUID()
  contactId: string;
 
}