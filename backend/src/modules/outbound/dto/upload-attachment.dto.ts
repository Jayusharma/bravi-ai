import { IsEnum, IsOptional } from 'class-validator';
import { AttachmentKind } from '@prisma/client';

export class UploadAttachmentDto {
  @IsEnum(AttachmentKind)
  @IsOptional()
  kind?: AttachmentKind;
}
