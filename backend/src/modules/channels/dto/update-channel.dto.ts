// update-channel.dto.ts — body shape for PATCH /channels/:id (rename or rotate credentials).
// All fields optional: send only what changed. Rotating apiKey re-runs the live SendGrid
// check before it's saved, same as create.

import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  apiKey?: string;

  @IsOptional()
  @IsEmail()
  fromEmail?: string;
}
