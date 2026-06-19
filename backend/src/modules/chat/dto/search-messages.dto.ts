import { IsString, IsNotEmpty, MaxLength, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchMessagesDto {
  /** Keyword to search message content for (case-insensitive). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q: string;

  /** Max results (default 50, max 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
