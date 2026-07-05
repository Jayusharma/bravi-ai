// update-channel.dto.ts — body for PATCH /chat/channels/:id (edit or archive).
// All optional: send only what changed. `archived: true` sets archivedAt (channel
// becomes read-only history, hidden from sidebars); `archived: false` restores it.

import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
