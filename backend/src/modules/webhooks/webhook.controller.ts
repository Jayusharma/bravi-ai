import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { type Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from 'src/common/decorator/public.decorator';
import { IngestionService } from '@/modules/Ingestion/ingestion.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';
import { SendGridInboundPayload } from './dto/email-sendgrid.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { ChannelsService } from '@/modules/channels/channels.service';
import { MessageChannel, ConnectionStatus, ChannelProvider } from '@prisma/client';
import { MetaWhatsAppNormalizer } from './normalizer/meta-whatsapp.normalizer';
import { MetaWhatsAppPayload } from './dto/whatsapp-webhook.dto';
import { MetaWebhookGuard } from './guards/meta-webhook.guard';
import { SendGridSignatureGuard } from './guards/sendgrid-signature.guard';

@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60000 } })
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly sendGridEmailNormalizer: SendGridEmailNormalizer,
    private readonly metaWhatsAppNormalizer: MetaWhatsAppNormalizer,
    private readonly channelsService: ChannelsService,
  ) { }

  // Hit by SendGrid Inbound Parse / Events every time an email arrives at a connected address.
  @Post('email')
  @UseGuards(SendGridSignatureGuard, IdempotencyGuard)
  @UseInterceptors(FileInterceptor('attachment'), IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleEmail(@Body() body: any) {
    const payload = body as SendGridInboundPayload;
    this.logger.log(`📧 SendGrid email webhook received: From=${payload?.from}, Subject="${payload?.subject ?? ''}"`);

    // The on/off toggle: only accept mail while the Email channel is connected AND turned on.
    const connection = await this.channelsService.findConnectionForChannel(MessageChannel.EMAIL);
    if (!connection || connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.warn('⚠️ SendGrid Email channel is disabled or missing in DB — dropping inbound email');
      return { status: 'skipped', reason: 'channel_disabled' };
    }

    const dto = this.sendGridEmailNormalizer.normalize(body);
    if (!dto) {
      this.logger.log('ℹ️ SendGrid email payload skipped (invalid payload or empty body)');
      return { status: 'skipped' };
    }

    await this.ingestionService.ingest(dto);
    await this.channelsService.markInboundReceived(connection.id);
    this.logger.log(`✅ Ingested SendGrid Email from ${dto.from} into EnquiryHub!`);
    return { status: 'accepted' };
  }

  // Hit by Meta ONCE, when you paste the callback URL into the App dashboard.
  // Meta sends hub.mode/hub.verify_token/hub.challenge — we echo the challenge back
  // only if the verify token matches the one saved on the Meta channel connection.
  @Get('whatsapp/meta')
  async verifyMetaWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`🌐 [GET Handshake] Received verify request: mode=${mode}, token=${token}`);
    const connection = await this.channelsService.findConnectionForProvider(ChannelProvider.META_WHATSAPP);
    const expected = connection ? this.channelsService.resolveMetaCredentials(connection).verifyToken : null;

    if (mode === 'subscribe' && expected && token === expected) {
      this.logger.log('✅ Meta webhook verified — challenge echoed');
      res.status(200).send(challenge); // must be the raw challenge string, nothing else
      return;
    }

    this.logger.warn('Meta webhook verification failed — verify token mismatch or no Meta connection');
    res.status(403).send('Forbidden');
  }

  // Hit by Meta on EVERY inbound WhatsApp message (and delivery receipts) for the connected number.
  @Post('whatsapp/meta')
  @UseGuards(MetaWebhookGuard, IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleMetaWhatsApp(@Body() body: any) {
    const payload = body as MetaWhatsAppPayload;
    const preview = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const isStatus = !!payload?.entry?.[0]?.changes?.[0]?.value?.statuses;

    this.logger.log(
      `Meta webhook received: ${
        isStatus
          ? '📋 [Delivery Status Receipt]'
          : `💬 From=${preview?.from}, Body="${preview?.text?.body?.substring(0, 80)}"`
      }`,
    );

    // The on/off toggle: only accept while the Meta WhatsApp channel is connected AND turned on.
    const connection = await this.channelsService.findConnectionForProvider(ChannelProvider.META_WHATSAPP);
    if (!connection || connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.warn('⚠️ Meta WhatsApp channel is disabled or missing in DB — dropping inbound message');
      return { status: 'skipped', reason: 'channel_disabled' };
    }

    const dto = this.metaWhatsAppNormalizer.normalize(payload);
    if (!dto) {
      this.logger.log('ℹ️ Meta payload ACKed with HTTP 200 (status receipt / media skipped)');
      return { status: 'skipped' };
    }

    await this.ingestionService.ingest(dto);
    await this.channelsService.markInboundReceived(connection.id);
    this.logger.log(`✅ Ingested Meta WhatsApp message ${dto.externalId} into EnquiryHub!`);
    return { status: 'accepted' };
  }
}
