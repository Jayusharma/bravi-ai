import { IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsOptional()
  @IsString()
  recipientOverride?: string;
}
