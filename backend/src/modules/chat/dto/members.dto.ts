// members.dto.ts — bodies for channel membership routes.

import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

// POST /chat/channels/:id/members — "Add People" in the details panel
export class AddMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];
}

// POST /chat/dm — open (or find) the 1-to-1 DM with another user
export class OpenDmDto {
  @IsUUID()
  userId!: string;
}
