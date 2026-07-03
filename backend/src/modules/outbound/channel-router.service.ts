// channel-router.service.ts — Routes outbound messages to the correct channel adapter.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionStatus, MessageChannel } from '@prisma/client';
import { SendParams, SendResult } from './adapters/channel-adapter.interface';
import { AdapterFactory } from './adapter.factory';
import { ChannelsService } from '../channels/channels.service';

@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly isDev: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly adapterFactory: AdapterFactory,
    private readonly channelsService: ChannelsService,
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

    // The on/off toggle: a connected-but-disabled channel is a hard block, no dev mock either
    // — the user explicitly turned it off and expects nothing to send.
    // No connection at all just means this channel hasn't been migrated to Administration →
    // Channels yet — the adapter falls through to its own default config below.
    const connection = await this.channelsService.findConnectionForChannel(channel);
    if (connection && connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.warn(`${channel} channel is disabled — blocking send`);
      return {
        success: false,
        error: `${channel} channel is disabled`,
        failReason: `${channel} is turned off. Turn it on in Administration → Channels.`,
      };
    }
    const creds = connection ? this.channelsService.resolveCredentials(connection) : undefined;

    if (!adapter.isConfigured(creds)) {
      if (this.isDev) return this.mockSend(channel, params, 'adapter not configured');
      this.logger.warn(`${channel} adapter not configured`);
      return { success: false, error: `${channel} adapter not configured`, failReason: `${channel} is not configured. Contact an admin.` };
    }

    this.logger.log(`📤 Routing ${channel} message to ${params.to}`);

    try {
      const result = await adapter.send(params, creds);
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
