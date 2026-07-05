// react.dto.ts — body for POST /chat/room/:roomId/messages/:messageId/reactions.
// Toggle semantics: same (user, emoji) again removes the reaction.

import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16) // single emoji grapheme (may be multi-codepoint)
  emoji!: string;
}
