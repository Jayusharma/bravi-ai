// create-channel.dto.ts — body shape for POST /channels ("Add Channel" in the UI).
// Only SENDGRID_EMAIL exists today (see ChannelProvider enum) — apiKey + fromEmail are
// its two required fields. When a second provider is added, this DTO grows a discriminated
// shape; it stays flat for now because there's only one provider to support.

import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ChannelProvider } from '@prisma/client';

export class CreateChannelDto {
  @IsEnum(ChannelProvider)
  provider!: ChannelProvider;

  // Shown in the channel list, e.g. "Sales Inbox"
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  // The SendGrid API key — encrypted before it ever touches the DB (see channels.service.ts)
  @IsString()
  @MinLength(10)
  apiKey!: string;

  // The verified sender address outbound mail is sent "from"
  @IsEmail()
  fromEmail!: string;
}
