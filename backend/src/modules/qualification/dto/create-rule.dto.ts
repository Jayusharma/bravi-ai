import {
  IsEnum,
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { RuleType } from '@prisma/client';

export class CreateRuleDto {
  @IsEnum(RuleType)
  type: RuleType;

  @IsString()
  value: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isCaseSensitive?: boolean;
}