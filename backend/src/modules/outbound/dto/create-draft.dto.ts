import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class CreateDraftDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  saveForLater?: boolean;
}
