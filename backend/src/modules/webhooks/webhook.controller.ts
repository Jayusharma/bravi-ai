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
import { Public } from 'src/common/decorator/public.decorator';
import { IngestionService } from '@/modules/Ingestion/ingestion.service';
import { TwilioWhatsAppNormalizer } from './normalizer/twilio-whatsapp.normalizer';
import { TwilioWhatsAppPayload } from './dto/twilio-whatsapp.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';
import { SendGridInboundPayload } from './dto/email-sendgrid.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { ChannelsService } from '@/modules/channels/channels.service';
import { MessageChannel, ConnectionStatus, ChannelProvider } from '@prisma/client';
import { MetaWhatsAppNormalizer } from './normalizer/meta-whatsapp.normalizer';
import { MetaWhatsAppPayload } from './dto/whatsapp-webhook.dto';

@Public()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly whatsappNormalizer: TwilioWhatsAppNormalizer,
    private readonly sendGridEmailNormalizer: SendGridEmailNormalizer,
    private readonly metaWhatsAppNormalizer: MetaWhatsAppNormalizer,
    private readonly channelsService: ChannelsService,
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

  // Hit by SendGrid Inbound Parse every time an email arrives at a connected address.
  @Post('email')
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(FileInterceptor('attachment'), IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleEmail(@Body() body: any) {
    const payload = body as SendGridInboundPayload;
    this.logger.log(`SendGrid webhook received: From=${payload?.from}, Body="${payload?.text?.substring(0, 80)}"`);

    // The on/off toggle: only accept mail while the Email channel is connected AND turned on.
    // No connection at all, or one the user has toggled off, both mean "don't receive".
    const connection = await this.channelsService.findConnectionForChannel(MessageChannel.EMAIL);
    if (!connection || connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.debug('Email channel is disabled — dropping inbound message');
      return { status: 'skipped', reason: 'channel_disabled' };
    }

    const dto = this.sendGridEmailNormalizer.normalize(body);
    if (!dto) {
      return { status: 'skipped' };
    }

    await this.ingestionService.ingest(dto);
    await this.channelsService.markInboundReceived(connection.id);
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
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  async handleMetaWhatsApp(@Body() body: any) {
    const payload = body as MetaWhatsAppPayload;
    const preview = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    this.logger.log(`Meta webhook received: From=${preview?.from}, Body="${preview?.text?.body?.substring(0, 80)}"`);

    // The on/off toggle: only accept while the Meta WhatsApp channel is connected AND turned on.
    // Looked up by PROVIDER (not channel) — a Twilio WhatsApp connection must not open this gate.
    const connection = await this.channelsService.findConnectionForProvider(ChannelProvider.META_WHATSAPP);
    if (!connection || connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.debug('Meta WhatsApp channel is disabled — dropping inbound message');
      return { status: 'skipped', reason: 'channel_disabled' };
    }

    const dto = this.metaWhatsAppNormalizer.normalize(payload);
    if (!dto) {
      // Delivery receipt / media / reaction — ACK with 200 so Meta doesn't retry or disable us.
      return { status: 'skipped' };
    }

    await this.ingestionService.ingest(dto);
    await this.channelsService.markInboundReceived(connection.id);
    return { status: 'accepted' };
  }
}
