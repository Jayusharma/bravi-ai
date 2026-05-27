import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';

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
    private readonly isDev: boolean;

    constructor(
        private config: ConfigService,
        private whatsappAdapter: WhatsAppAdapter,
        private emailAdapter: EmailAdapter,
    ) {
        this.adapters = new Map();
        this.adapters.set(MessageChannel.WHATSAPP, whatsappAdapter);
        this.adapters.set(MessageChannel.EMAIL, emailAdapter);
        this.isDev = this.config.get<string>('NODE_ENV', 'production') !== 'production';
    }

    async send(
        channel: MessageChannel,
        params: SendParams,
    ): Promise<SendResult> {
        const adapter = this.adapters.get(channel);

        if (!adapter) {
            if (this.isDev) return this.mockSend(channel, params, 'no adapter registered');
            this.logger.warn(`No adapter for channel: ${channel}`);
            return { success: false, error: `No adapter for ${channel}` };
        }

        if (!adapter.isConfigured()) {
            if (this.isDev) return this.mockSend(channel, params, 'adapter not configured');
            this.logger.warn(`${channel} adapter not configured`);
            return { success: false, error: `${channel} adapter not configured` };
        }

        this.logger.log(`📤 Routing ${channel} message to ${params.to}`);

        try {
            const result = await adapter.send(params);
            // In dev mode, treat adapter failures as mock success so the flow completes
            if (!result.success && this.isDev) {
                return this.mockSend(channel, params, result.error ?? 'adapter returned failure');
            }
            return result;
        } catch (err: any) {
            if (this.isDev) return this.mockSend(channel, params, err.message);
            throw err;
        }
    }

    private mockSend(channel: MessageChannel, params: SendParams, reason: string): SendResult {
        const fakeId = `mock_${channel.toLowerCase()}_${Date.now()}`;
        this.logger.warn(
            `🧪 [DEV MOCK] ${channel} → ${params.to} | reason: ${reason}\n` +
            `   body: "${(params.content || '').substring(0, 80)}${(params.content || '').length > 80 ? '…' : ''}"\n` +
            `   attachments: ${params.attachments?.length ?? 0}\n` +
            `   fakeId: ${fakeId}`,
        );
        return { success: true, externalId: fakeId };
    }
}