import { IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesDto {
  /** Page size (default 30, max 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Message id to page from — returns messages OLDER than this one. */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
