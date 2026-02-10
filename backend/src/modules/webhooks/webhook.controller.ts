import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { EmailWebhookDto } from './dto/email.dto';
import { IngestionService } from '../Ingestion/ingestion.service';
import { Public } from 'src/common/decorator/public.decorator';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { MessageChannel } from '../Ingestion/dto/incoming-message.dto';

@Public()
@Controller('webhook/email')
export class EmailWebhookController {
  constructor(private ingestionService: IngestionService) {}

  @Post()
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  ingest(@Body() dto: EmailWebhookDto) {
    return this.ingestionService.ingest({
        channel: MessageChannel.EMAIL,
        externalMessageId: dto.externalMessageId,
        from: dto.from,
        subject: dto.subject,
        content: dto.content,
      });;
  }
}
