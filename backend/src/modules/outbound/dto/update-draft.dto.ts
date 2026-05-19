import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class UpdateDraftDto {
  @IsOptional()
  @IsEnum(MessageChannel)
  channel?: MessageChannel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;
}