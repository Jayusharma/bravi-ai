// meta-whatsapp.normalizer.ts — turns a raw Meta Cloud API webhook payload into the
// standard IngestMessageDto, exactly like the Twilio/SendGrid normalizers do for theirs.

import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { IngestMessageDto } from '@/modules/Ingestion/dto/incoming-message.dto';
import { WebhookNormalizer } from './normalizer.interface';
import { MetaWhatsAppPayload } from '../dto/whatsapp-webhook.dto';

@Injectable()
export class MetaWhatsAppNormalizer implements WebhookNormalizer<MetaWhatsAppPayload> {
    private readonly logger = new Logger(MetaWhatsAppNormalizer.name);

    /**
     * Only process actual inbound text messages.
     * Meta POSTs delivery receipts (value.statuses[]) and non-text types (media, reactions…)
     * to the same URL — those return false here and the webhook just ACKs them.
     */
    canProcess(payload: MetaWhatsAppPayload): boolean {
        const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        return !!(msg && msg.type === 'text' && msg.text?.body?.trim());
    }

    normalize(payload: MetaWhatsAppPayload): IngestMessageDto | null {
        if (!this.canProcess(payload)) {
            this.logger.debug('Skipping Meta payload — no text message (status callback or media)');
            return null;
        }

        const value = payload.entry![0].changes![0].value;
        const msg = value.messages![0];

        // Meta sends numbers WITHOUT '+' ("919876..."). Twilio stores "+919876...".
        // Prefix '+' so the SAME person maps to the SAME ContactChannel across providers.
        const from = `+${msg.from}`;
        const to = value.metadata?.display_phone_number;

        this.logger.log(`📥 Normalizing Meta WhatsApp message from ${from}: "${msg.text!.body.substring(0, 50)}"`);

        return {
            channel: MessageChannel.WHATSAPP,
            externalId: msg.id, // wamid.xxx — globally unique, our dedup key
            from,
            to,
            body: msg.text!.body,
            displayName: value.contacts?.[0]?.profile?.name,
            rawPayload: payload as unknown as Record<string, any>,
        };
    }
}
