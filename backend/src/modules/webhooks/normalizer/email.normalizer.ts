import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { MessageChannel } from '@prisma/client';
import { IngestMessageDto } from '@/modules/Ingestion/dto/incoming-message.dto';
import { WebhookNormalizer } from './normalizer.interface';
import { SendGridInboundPayload } from '../dto/email-sendgrid.dto';

@Injectable()
export class SendGridEmailNormalizer
  implements WebhookNormalizer<SendGridInboundPayload> {

  private readonly logger = new Logger(SendGridEmailNormalizer.name);

  canProcess(payload: SendGridInboundPayload): boolean {
    return !!(payload?.from && (payload.text || payload.html));
  }

  normalize(payload: SendGridInboundPayload): IngestMessageDto | null {
    if (!this.canProcess(payload)) {
      this.logger.debug(`Skipping email â€” invalid payload`);
      return null;
    }

    const from = this.extractEmail(payload.from);
    const to = this.extractEmail(payload.to);
    const subject = payload.subject?.trim() || undefined;
    const body = payload.text?.trim() || this.stripHtml(payload.html || '') || '';
    const externalId =
      this.extractMessageId(payload.headers) ||
      this.buildSyntheticExternalId(from, to, subject, body);

    this.logger.log(`ðŸ“¥ Email from ${from}: "${body.substring(0, 50)}"`);

    return {
      channel: MessageChannel.EMAIL,
      externalId,
      from,
      to,
      subject,
      body,
      displayName: this.extractName(payload.from),
      rawPayload: payload as unknown as Record<string, any>,
    };
  }

  private extractEmail(input: string): string {
    if (!input) return '';
    const match = input.match(/<(.+?)>/);
    return (match ? match[1] : input).trim().toLowerCase();
  }

  private extractName(input: string): string | undefined {
    const match = input.match(/^(.+?)\s*</);
    return match ? match[1] : undefined;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private extractMessageId(headers: string): string {
    const match = headers?.match(/Message-ID:\s*<(.+?)>/i);
    return match ? match[1].trim() : '';
  }

  private buildSyntheticExternalId(
    from: string,
    to: string,
    subject: string | undefined,
    body: string,
  ): string {
    const fingerprint = createHash('sha256')
      .update([from, to, subject || '', body].join('|'))
      .digest('hex');
    return `email-fallback-${fingerprint}`;
  }
}
