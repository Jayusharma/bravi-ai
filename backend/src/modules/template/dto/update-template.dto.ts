import { PartialType } from '@nestjs/swagger';
import { CreateTemplateDto } from './create-template.dto';

/**
 * Update a message template. All fields optional.
 * Freeze rule (PENDING/APPROVED → 403) and body re-parsing are enforced in Step 3.
 */
export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}
