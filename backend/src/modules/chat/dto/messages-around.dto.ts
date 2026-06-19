import { IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class MessagesAroundDto {
  /** The message to center the window on. */
  @IsUUID()
  messageId: string;

  /** How many messages to load before the target (default 25, max 50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  before?: number;

  /** How many messages to load after the target (default 25, max 50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  after?: number;
}
