import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MessageChannel,
  TemplateType,
  WaContentType,
  WaTemplateCategory,
} from '@prisma/client';

/**
 * Create a message template.
 * NOTE: validation/parsing logic (variable extraction, name-format rules for
 * WHATSAPP, sequential positions) lands in Step 3 — this is the shape only.
 */
export class CreateTemplateDto {
  @IsEnum(TemplateType)
  type!: TemplateType;

  // slug: lowercase + underscores (enforced for WHATSAPP in Step 3)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  friendlyName!: string;

  // Templates only target WHATSAPP | EMAIL (validated in Step 3 — enum also has SMS)
  @IsEnum(MessageChannel)
  channel!: MessageChannel;

  @IsOptional()
  @IsString()
  language?: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsEnum(WaContentType)
  contentType?: WaContentType;

  @IsOptional()
  @IsObject()
  buttons?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  headerMediaUrl?: string;

  @IsOptional()
  @IsEnum(WaTemplateCategory)
  category?: WaTemplateCategory;

  @IsOptional()
  @IsObject()
  sampleValues?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  internalCategory?: string;

  @IsOptional()
  usedCount?: number;
}
