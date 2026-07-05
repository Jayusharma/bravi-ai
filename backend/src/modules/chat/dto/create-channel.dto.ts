// create-channel.dto.ts — body for POST /chat/channels ("Create Channel" modal).
// Only ADMIN/MANAGER reach this route (CASL create:chatchannel); the creator
// automatically becomes the channel's ChatParticipant ADMIN.

import { ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateChannelDto {
  // Channel name shown in the sidebar, e.g. "sales-updates"
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // Purpose line shown in the header + details panel
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Initial members (besides the creator) — all become MEMBER role
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds?: string[];
}
