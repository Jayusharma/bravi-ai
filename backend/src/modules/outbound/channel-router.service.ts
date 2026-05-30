// channel-router.service.ts — Routes outbound messages to the correct channel adapter.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { SendParams, SendResult } from './adapters/channel-adapter.interface';
import { AdapterFactory } from './adapter.factory';

@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly isDev: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly adapterFactory: AdapterFactory,
  ) {
    this.isDev = this.config.get<string>('NODE_ENV', 'production') !== 'production';
  }

  /** Routes a message to the correct adapter; falls back to mock in development when unconfigured */
  async send(channel: MessageChannel, params: SendParams): Promise<SendResult> {
    const adapter = this.adapterFactory.getAdapter(channel);

    if (!adapter) {
      if (this.isDev) return this.mockSend(channel, params, 'no adapter registered');
      this.logger.warn(`No adapter for channel: ${channel}`);
      return { success: false, error: `No adapter for ${channel}`, failReason: `No adapter registered for ${channel}.` };
    }

    if (!adapter.isConfigured()) {
      if (this.isDev) return this.mockSend(channel, params, 'adapter not configured');
      this.logger.warn(`${channel} adapter not configured`);
      return { success: false, error: `${channel} adapter not configured`, failReason: `${channel} is not configured. Contact an admin.` };
    }

    this.logger.log(`📤 Routing ${channel} message to ${params.to}`);

    try {
      const result = await adapter.send(params);
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
