import { IsEnum, IsString, IsBoolean, IsOptional } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class AddChannelDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsString()
  identifier: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
