import { IsEnum, IsString, IsOptional } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class CreateContactDto {
  @IsString()
  displayName: string;

  @IsOptional()
  @IsString()
  organization?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsString()
  identifier: string;
}
