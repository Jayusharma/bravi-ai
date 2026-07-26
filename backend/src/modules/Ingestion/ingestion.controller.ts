import { Controller, Post, Body, Headers , UseGuards , UseInterceptors , HttpCode , HttpStatus  } from '@nestjs/common';
import { IngestionService } from "./ingestion.service";
import { IngestMessageDto ,  validateIngestMessageDto } from './dto/incoming-message.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';

@Controller('ingestion')
export class IngestionController {
  constructor(private ingestionService: IngestionService) {}

  /**
   * POST /api/v1/ingestion/message
   * Ingest a raw message for qualification.
   * Nothing in this codebase calls this over HTTP — webhook handlers call
   * IngestionService.ingest() in-process. Kept for authenticated internal/manual use;
   * requires a valid JWT like everything else now that it's no longer @Public().
   */
  @Post('message')
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.ACCEPTED)
  ingestMessage(@Body() dto: IngestMessageDto) {
    validateIngestMessageDto(dto.channel , dto.from)
    return this.ingestionService.ingest(dto);
  }
}
