// dlq.controller.ts — Admin endpoints for dead letter queue management.

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { CaslGuard } from '../../casl/casl.guard';
import { CheckAbility } from '../../casl/decorators/check-ability.decorator';
import { DlqService } from './dlq.service';

@Controller('outbound/dlq')
@UseGuards(CaslGuard)
export class DlqController {
  constructor(private readonly dlqService: DlqService) {}

  /** Lists all unresolved failed messages */
  @Get()
  @CheckAbility({ action: 'read', subject: 'deadletter' })
  listFailed(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dlqService.listFailed(
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  /** Re-queues a dead-letter entry for delivery retry */
  @Post(':id/retry')
  @CheckAbility({ action: 'manage', subject: 'deadletter' })
  retryFromDlq(@Param('id') id: string, @Req() req: Request) {
    return this.dlqService.retryFromDlq(id, req.user!.userId);
  }

  /** Permanently discards a dead-letter entry without retrying */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'manage', subject: 'deadletter' })
  discard(@Param('id') id: string, @Req() req: Request) {
    return this.dlqService.discard(id, req.user!.userId);
  }
}
