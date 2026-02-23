import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MessageChannel, MessageDirection } from '@prisma/client';

export class AddMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsOptional()
  @IsEnum(MessageDirection)
  direction?: MessageDirection;

  @IsString()
  from: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsString()
  externalId?: string;
}