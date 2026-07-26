// channel-router.service.ts — Routes outbound messages to the correct channel adapter.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelProvider, ConnectionStatus, MessageChannel } from '@prisma/client';
import { ResolvedCredentials, SendParams, SendResult } from './adapters/channel-adapter.interface';
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
    // Connection first — its provider decides WHICH adapter handles this send
    // (Meta connection → Meta adapter; none → channel default).
    const connection = await this.channelsService.findConnectionForChannel(channel);

    // The on/off toggle: a connected-but-disabled channel is a hard block, no dev mock either
    // — the user explicitly turned it off and expects nothing to send.
    if (connection && connection.status !== ConnectionStatus.ACTIVE) {
      this.logger.warn(`${channel} channel is disabled — blocking send`);
      return {
        success: false,
        error: `${channel} channel is disabled`,
        failReason: `${channel} is turned off. Turn it on in Administration → Channels.`,
      };
    }

    const adapter = this.adapterFactory.getAdapter(channel, connection?.provider);

    if (!adapter) {
      if (this.isDev) return this.mockSend(channel, params, 'no adapter registered');
      this.logger.warn(`No adapter for channel: ${channel}`);
      return { success: false, error: `No adapter for ${channel}`, failReason: `No adapter registered for ${channel}.` };
    }

    // Decrypt the connection's credentials in the shape its provider's adapter expects.
    let creds: ResolvedCredentials | undefined;
    if (connection?.provider === ChannelProvider.SENDGRID_EMAIL) {
      creds = this.channelsService.resolveCredentials(connection);
    } else if (connection?.provider === ChannelProvider.META_WHATSAPP) {
      const meta = this.channelsService.resolveMetaCredentials(connection);
      creds = { accessToken: meta.accessToken, phoneNumberId: meta.phoneNumberId };
    }

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
