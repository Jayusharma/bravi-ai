import { IsString } from 'class-validator';

export class EmailWebhookDto {
  @IsString()
  externalMessageId: string;

  @IsString()
  from: string;

  @IsString()
  subject: string;

  @IsString()
  content: string;
}
