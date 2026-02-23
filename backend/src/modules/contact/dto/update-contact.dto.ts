import { IsOptional, IsString } from 'class-validator';

/**
 * Used by staff to update a Contact's profile.
 * Name, organization, and notes can be edited.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  organization?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}