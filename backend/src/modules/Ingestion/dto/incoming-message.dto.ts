import { IsEnum, IsString, IsOptional, IsObject, isString } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class IngestMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsOptional()
  @IsString()
  externalId?: string; // WhatsApp message ID, email Message-ID, etc.

  @IsString()
  from: string; // Phone number or email address

  @IsOptional()
  @IsString()
  to?: string; // Your receiving number/email

  @IsOptional()
  @IsString()
  subject?: string; // Email subject (strong qualifying signal)

  @IsString()
  body: string; // The actual message text

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, any>; // Full webhook payload for debugging
}