// adapter.factory.ts — Returns the correct channel adapter by MessageChannel enum value.

import { Injectable } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';

@Injectable()
export class AdapterFactory {
  private readonly adapters: Map<MessageChannel, ChannelAdapter>;

  constructor(
    private readonly whatsapp: WhatsAppAdapter,
    private readonly email: EmailAdapter,
  ) {
    this.adapters = new Map<MessageChannel, ChannelAdapter>([
      [MessageChannel.WHATSAPP, whatsapp],
      [MessageChannel.EMAIL, email],
    ]);
  }

  /** Returns the adapter for the given channel, or null if unsupported */
  getAdapter(channel: MessageChannel): ChannelAdapter | null {
    return this.adapters.get(channel) ?? null;
  }
}
