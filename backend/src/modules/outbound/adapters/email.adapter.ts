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

      // Fetch attachment files from CDN and encode as base64 for SendGrid
      if (params.attachments && params.attachments.length > 0) {
        const sgAttachments: { content: string; filename: string; type: string; disposition: string }[] = [];

        for (const att of params.attachments) {
          try {
            const res = await fetch(att.cdnUrl);
            if (!res.ok) {
              this.logger.warn(`Failed to fetch attachment ${att.fileName}: HTTP ${res.status}`);
              continue;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            sgAttachments.push({
              content: buffer.toString('base64'),
              filename: att.fileName,
              type: att.mimeType,
              disposition: 'attachment',
            });
          } catch (fetchErr: any) {
            this.logger.warn(`Failed to fetch attachment ${att.fileName}: ${fetchErr.message}`);
          }
        }

        if (sgAttachments.length > 0) {
          (msg as any).attachments = sgAttachments;
        }
      }

      const [response] = await sgMail.send(msg);
      const messageId = response.headers['x-message-id'] as string | undefined;

      this.logger.log(`📧 Email sent to ${params.to} — MessageId: ${messageId ?? 'unknown'} (${params.attachments?.length ?? 0} attachment(s))`);
      return { success: true, externalId: messageId };
    } catch (error: any) {
      const detail = error?.response?.body?.errors?.[0]?.message ?? error.message;
      this.logger.error(`Email send error to ${params.to}: ${detail}`);
      return {
        success: false,
        error: detail,
        failReason: this.mapSendGridError(error),
      };
    }
  }

  /** Maps SendGrid error responses to agent-readable failure reasons */
  private mapSendGridError(error: any): string {
    const status = error?.response?.status ?? error?.code;
    const sgMessages: Record<number, string> = {
      400: 'Email rejected — invalid request (check subject and recipient address).',
      401: 'SendGrid authentication failed — contact an admin.',
      403: 'Sender address not verified in SendGrid.',
      413: 'Attachments are too large — total must be under 25MB.',
      429: 'Too many emails sent too quickly — message queued for retry.',
    };
    const firstError = error?.response?.body?.errors?.[0]?.message;
    return sgMessages[status] ?? firstError ?? error.message ?? 'Email delivery failed.';
  }
}