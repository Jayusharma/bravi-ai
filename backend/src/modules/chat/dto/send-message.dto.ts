import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttachmentKind } from '@prisma/client';

/**
 * One uploaded-file descriptor, exactly as returned by
 * POST /chat/room/:id/attachments. The client uploads first, then sends the
 * message with these descriptors — sendMessage turns them into ChatAttachment rows.
 */
export class ChatAttachmentInput {
  @IsEnum(AttachmentKind)
  kind!: AttachmentKind;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @IsInt()
  fileSize!: number;

  @IsString()
  @MaxLength(512)
  storageKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cdnUrl?: string;
}

export class SendMessageDto {
  /** Text body. Optional when attachments are present (media-only message). */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsString()
  @IsOptional()
  @IsUUID()
  parentMessageId?: string;

  /** Descriptors from the upload endpoint — persisted with the message in one transaction. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentInput)
  attachments?: ChatAttachmentInput[];
}
