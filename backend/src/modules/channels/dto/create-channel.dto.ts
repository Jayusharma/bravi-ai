// create-channel.dto.ts — body shape for POST /channels ("Add Channel" in the UI).
// One endpoint serves every provider, so provider-specific fields are optional here and
// channels.service.create() asserts the required set per provider:
//   SENDGRID_EMAIL → apiKey + fromEmail
//   META_WHATSAPP  → phoneNumberId + accessToken + verifyToken

import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ChannelProvider } from '@prisma/client';

export class CreateChannelDto {
  @IsEnum(ChannelProvider)
  provider!: ChannelProvider;

  // Shown in the channel list, e.g. "Sales Inbox" / "Sales WhatsApp"
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  // ── SendGrid (email) ──
  // The SendGrid API key — encrypted before it ever touches the DB (see channels.service.ts)
  @IsOptional()
  @IsString()
  @MinLength(10)
  apiKey?: string;

  // The verified sender address outbound mail is sent "from"
  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  // SendGrid Event Webhook Signed Verification Key (Public Key) — saved in DB for signature verification
  @IsOptional()
  @IsString()
  @MinLength(10)
  verificationKey?: string;

  // ── Meta WhatsApp (Cloud API) ──
  // The sender identity from the Meta App dashboard (WhatsApp → API Setup → Phone Number ID)
  @IsOptional()
  @IsString()
  @MinLength(5)
  phoneNumberId?: string;

  // System User access token — used to validate now and to send messages later
  @IsOptional()
  @IsString()
  @MinLength(10)
  accessToken?: string;

  // A string the USER chooses; Meta echoes it in the webhook-verify GET and we must match it
  @IsOptional()
  @IsString()
  @MinLength(6)
  verifyToken?: string;

  // App Secret from Meta App Dashboard — encrypted and saved in DB for HMAC signature verification
  @IsOptional()
  @IsString()
  @MinLength(6)
  appSecret?: string;
}
