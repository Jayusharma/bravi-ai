import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './channel-adapter.interface';

/**
 * Sends messages via WhatsApp Business Cloud API.
 *
 * PREREQUISITE:
 *   - Meta Business account with WhatsApp Business API access
 *   - WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env
 *   - The recipient must have messaged you first (WhatsApp 24h window)
 *     OR you use a pre-approved message template
 *
 * API: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.WHATSAPP;
  private readonly logger = new Logger(WhatsAppAdapter.name);

  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(private config: ConfigService) {
    this.apiUrl = this.config.get('WHATSAPP_API_URL', 'https://graph.facebook.com/v18.0');
    this.phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', '');
    this.accessToken = this.config.get('WHATSAPP_ACCESS_TOKEN', '');
  }

  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.isConfigured()) {
      this.logger.warn('WhatsApp adapter not configured — skipping send');
      return { success: false, error: 'WhatsApp not configured' };
    }

    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to.replace(/\D/g, ''), // Strip non-digits
          type: 'text',
          text: { body: params.content },
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        const errorMsg = data?.error?.message || `HTTP ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const externalId = data?.messages?.[0]?.id;
      this.logger.log(`📱 WhatsApp message sent: ${externalId} → ${params.to}`);

      return { success: true, externalId };
    } catch (error) {
      this.logger.error(`WhatsApp send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}