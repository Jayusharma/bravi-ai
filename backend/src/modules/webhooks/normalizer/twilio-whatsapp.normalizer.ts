import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { IngestMessageDto } from '@/modules/Ingestion/dto/incoming-message.dto';
import { WebhookNormalizer } from './normalizer.interface';
import { TwilioWhatsAppPayload } from '../dto/twilio-whatsapp.dto';

@Injectable()
export class TwilioWhatsAppNormalizer implements WebhookNormalizer<TwilioWhatsAppPayload> {
    private readonly logger = new Logger(TwilioWhatsAppNormalizer.name);

    /**
     * Only process actual inbound messages.
     * Twilio sends status callbacks (delivered, read, failed) to the same URL —
     * we filter those out by checking that Body is non-empty and SmsStatus === 'received'.
     */
    canProcess(payload: TwilioWhatsAppPayload): boolean {
        return !!(payload?.Body && payload.Body.trim().length > 0);
    }

    normalize(payload: TwilioWhatsAppPayload): IngestMessageDto | null {
        if (!this.canProcess(payload)) {
            this.logger.debug(
                `Skipping Twilio payload — no body (likely a status callback). SmsStatus=${payload?.SmsStatus}`,
            );
            return null;
        }

        // Strip 'whatsapp:' prefix from From / To
        const from = payload.From?.replace('whatsapp:', '') ?? '';
        const to = payload.To?.replace('whatsapp:', '') ?? '';

        this.logger.log(`📥 Normalizing WhatsApp message from ${from}: "${payload.Body.substring(0, 50)}"`);

        return {
            channel: MessageChannel.WHATSAPP,
            externalId: payload.MessageSid,
            from,
            to,
            body: payload.Body,
            displayName: payload.ProfileName,
            rawPayload: payload as unknown as Record<string, any>,
        };
    }
}
