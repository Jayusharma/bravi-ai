import { IsEnum, IsString, IsOptional } from 'class-validator';

export enum MessageChannel {
  EMAIL = 'EMAIL',
  WHATSAPP = 'WHATSAPP',
}

export class IncomingMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsString()
  externalMessageId: string; // Gmail messageId, WhatsApp messageId

  @IsString()
  from: string; // email or phone

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  receivedAt?: string;
}
