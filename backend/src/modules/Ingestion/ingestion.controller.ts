import { Controller, Post, Body, Headers , UseGuards , UseInterceptors  } from '@nestjs/common';
import { IngestionService } from "./ingestion.service";
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';

@Controller('ingestion')
export class IngestionController {
  constructor(private ingestionService: IngestionService) {}


@Post('message')
@UseGuards(IdempotencyGuard)
@UseInterceptors(IdempotencyInterceptor)

ingestMessage(@Body() dto: IncomingMessageDto) {
 
  return this.ingestionService.ingest(dto);
}
}
