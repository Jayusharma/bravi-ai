import { IsEnum, IsString, IsOptional, IsObject, isString } from 'class-validator';
import { MessageChannel } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

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
  subject?: string; // Email subject for storage/threading only; not used by AI qualification

  @IsString()
  body: string; // The actual message text

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, any>; // Full webhook payload for debugging
}

export function validateIngestMessageDto(channel:string , from: string ) {
  
   if (channel === 'WHATSAPP') {
    if (!/^\+\d{10,15}$/.test(from)) {
      throw new BadRequestException('WhatsApp requires a valid phone number');
    }
  }

  if( channel === MessageChannel.EMAIL && !from.includes('@')){
    throw new BadRequestException('Invalide email identity ')
  }

 
}   
