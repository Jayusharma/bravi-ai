import { Controller, Post, Body, Headers , UseGuards , UseInterceptors , HttpCode , HttpStatus  } from '@nestjs/common';
import { IngestionService } from "./ingestion.service";
import { IngestMessageDto ,  validateIngestMessageDto } from './dto/incoming-message.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { Public } from 'src/common/decorator/public.decorator';

@Controller('ingestion')
export class IngestionController {
  constructor(private ingestionService: IngestionService) {}

  /**
   * POST /api/v1/ingestion/message
   * Ingest a raw message for qualification.
   * Public endpoint (called by webhook handlers).
   */
  @Post('message')
  @Public()
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.ACCEPTED)
  ingestMessage(@Body() dto: IngestMessageDto) {
    validateIngestMessageDto(dto.channel , dto.from)
    return this.ingestionService.ingest(dto);
  }
}
