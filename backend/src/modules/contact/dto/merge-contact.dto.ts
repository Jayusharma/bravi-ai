import { IsUUID } from 'class-validator';

export class MergeContactsDto {
  @IsUUID()
  sourceContactId: string; // The duplicate — will be DELETED

  @IsUUID()
  targetContactId: string; // The primary — keeps everything
}
