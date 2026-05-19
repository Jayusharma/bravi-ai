import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import * as sgMail from '@sendgrid/mail';
import { ChannelAdapter, SendParams, SendResult } from './channel-adapter.interface';

/**
 * Sends outbound email via SendGrid.
 *
 * Required env vars:
 *   SENDGRID_API_KEY  - SendGrid API key (starts with SG.)
 *   SENDGRID_FROM     - Verified sender email e.g. noreply@yourdomain.com
 */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.EMAIL;
  private readonly logger = new Logger(EmailAdapter.name);

  private readonly fromEmail: string;
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY', '');
    this.fromEmail = this.config.get<string>('SENDGRID_FROM', '');

    if (apiKey && this.fromEmail) {
      sgMail.setApiKey(apiKey);
      this.configured = true;
      this.logger.log('✅ SendGrid email adapter initialized');
    } else {
      this.configured = false;
      this.logger.warn('⚠️ SendGrid credentials missing — Email adapter disabled');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Email (SendGrid) not configured' };
    }

    try {
      const msg: sgMail.MailDataRequired = {
        to: params.to,
        from: this.fromEmail,
        subject: params.subject ?? '(no subject)',
        text: params.content,
        html: params.content,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      };

      const [response] = await sgMail.send(msg);
      const messageId = response.headers['x-message-id'] as string | undefined;

      this.logger.log(`📧 Email sent to ${params.to} — MessageId: ${messageId ?? 'unknown'}`);
      return { success: true, externalId: messageId };
    } catch (error: any) {
      const detail = error?.response?.body?.errors?.[0]?.message ?? error.message;
      this.logger.error(`Email send error to ${params.to}: ${detail}`);
      return { success: false, error: detail };
    }
  }
}