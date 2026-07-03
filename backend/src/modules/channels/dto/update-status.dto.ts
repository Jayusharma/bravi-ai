// update-status.dto.ts — body shape for PATCH /channels/:id/status. This IS the on/off toggle.

import { IsEnum } from 'class-validator';
import { ConnectionStatus } from '@prisma/client';

export class UpdateStatusDto {
  @IsEnum(ConnectionStatus)
  status!: ConnectionStatus;
}
