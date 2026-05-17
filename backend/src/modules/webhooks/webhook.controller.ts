import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { type Response } from 'express';
import { Public } from 'src/common/decorator/public.decorator';
import { IngestionService } from '@/modules/Ingestion/ingestion.service';
import { TwilioWhatsAppNormalizer } from './normalizer/twilio-whatsapp.normalizer';
import { TwilioWhatsAppPayload } from './dto/twilio-whatsapp.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';
import { SendGridInboundPayload } from './dto/email-sendgrid.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';

@Public()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly whatsappNormalizer: TwilioWhatsAppNormalizer,
    private readonly sendGridEmailNormalizer: SendGridEmailNormalizer,
  ) { }

  @Post('whatsapp')
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleWhatsApp(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    const payload = body as TwilioWhatsAppPayload;
    this.logger.log(`ðŸ“¨ Twilio webhook received: From=${payload?.From}, Body="${payload?.Body?.substring(0, 80)}"`);

    const dto = this.whatsappNormalizer.normalize(body);

    if (dto) {
      await this.ingestionService.ingest(dto);
    } else {
      this.logger.debug('Webhook payload skipped (status callback or empty body)');
    }

    res.set('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
  }

  @Post('email')
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(FileInterceptor('attachment'), IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleEmail(@Body() body: any) {
    const payload = body as SendGridInboundPayload;
    this.logger.log(`SendGrid webhook received: From=${payload?.from}, Body="${payload?.text?.substring(0, 80)}"`);

    const dto = this.sendGridEmailNormalizer.normalize(body);
    if (!dto) {
      return { status: 'skipped' };
    }

    await this.ingestionService.ingest(dto);
    return { status: 'accepted' };
  }
}
