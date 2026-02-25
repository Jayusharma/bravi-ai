import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
// import { EmailAdapter } from './adapters/email.adapter';

/**
 * Routes outbound messages to the correct channel adapter.
 *
 * WHY THIS EXISTS:
 *   The caller says: "Send this message via WHATSAPP to +91-9876..."
 *   This service finds the right adapter and calls it.
 *
 * MOCK MODE:
 *   Set WHATSAPP_MOCK=true in .env → uses MockWhatsAppAdapter
 *   (logs to console, returns fake IDs, no real API call)
 */
@Injectable()
export class ChannelRouterService {
    private readonly logger = new Logger(ChannelRouterService.name);
    private readonly adapters: Map<MessageChannel, ChannelAdapter>;

    constructor(
        private config: ConfigService,
        private whatsappAdapter: WhatsAppAdapter,
        // private emailAdapter: EmailAdapter,
    ) {
        this.adapters = new Map();

        // ─── Pick mock or real adapter based on env ───
        const useMock = this.config.get('WHATSAPP_MOCK', 'true') === 'true';
        this.adapters.set(MessageChannel.WHATSAPP, whatsappAdapter)
        // this.adapters.set(MessageChannel.EMAIL, emailAdapter);
    }

    async send(
        channel: MessageChannel,
        params: SendParams,
    ): Promise<SendResult> {
        const adapter = this.adapters.get(channel);

        if (!adapter) {
            this.logger.warn(`No adapter for channel: ${channel}`);
            return { success: false, error: `No adapter for ${channel}` };
        }

        if (!adapter.isConfigured()) {
            this.logger.warn(`${channel} adapter not configured`);
            return { success: false, error: `${channel} adapter not configured` };
        }

        this.logger.log(`📤 Routing ${channel} message to ${params.to}`);
        return adapter.send(params);
    }
}