import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './channel-adapter.interface';
import Twilio from 'twilio';

/**
 * Sends outbound WhatsApp messages via Twilio Messaging API.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID   - Your Twilio Account SID (ACxxxxxxx)
 *   TWILIO_AUTH_TOKEN    - Your Twilio Auth Token
 *   TWILIO_WHATSAPP_NUMBER - e.g. whatsapp:+14155238886
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.WHATSAPP;
  private readonly logger = new Logger(WhatsAppAdapter.name);

  private client: Twilio.Twilio | null = null;
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID', '');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN', '');
    this.fromNumber = this.config.get<string>('TWILIO_WHATSAPP_NUMBER', '');

    if (sid && token) {
      this.client = Twilio(sid, token);
      this.logger.log('✅ Twilio WhatsApp adapter initialized');
    } else {
      this.logger.warn('⚠️ Twilio credentials missing — WhatsApp adapter disabled');
    }
  }

  isConfigured(): boolean {
    return !!(this.client && this.fromNumber);
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.isConfigured()) {
      this.logger.warn('WhatsApp adapter not configured — skipping send');
      return { success: false, error: 'WhatsApp (Twilio) not configured' };
    }

    try {
      const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;
      const mediaUrls = (params.attachments ?? [])
        .filter((a) => a.cdnUrl)
        .map((a) => a.cdnUrl);

      // Twilio WhatsApp: send body + up to 10 media URLs in one message
      const createParams: Record<string, unknown> = {
        from: this.fromNumber,
        to,
        body: params.content || '',
      };
      if (mediaUrls.length > 0) {
        createParams.mediaUrl = mediaUrls;
      }

      const message = await this.client!.messages.create(createParams as any);

      this.logger.log(`📱 WhatsApp sent: SID=${message.sid} → ${params.to} (${mediaUrls.length} media)`);
      return { success: true, externalId: message.sid };
    } catch (error: any) {
      this.logger.error(`WhatsApp send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}