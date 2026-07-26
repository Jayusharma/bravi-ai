// adapter.factory.ts — Returns the correct channel adapter for an outbound send.
//
// Selection is provider-first: if the active ChannelConnection says META_WHATSAPP, the Meta
// adapter wins. With no connection we fall back to the per-channel default.

import { Injectable } from '@nestjs/common';
import { ChannelProvider, MessageChannel } from '@prisma/client';
import { ChannelAdapter } from './adapters/channel-adapter.interface';
import { EmailAdapter } from './adapters/email.adapter';
import { MetaWhatsAppAdapter } from './adapters/meta-whatsapp.adapter';

@Injectable()
export class AdapterFactory {
  private readonly adapters: Map<MessageChannel, ChannelAdapter>;

  constructor(
    private readonly email: EmailAdapter,
    private readonly metaWhatsApp: MetaWhatsAppAdapter,
  ) {
    this.adapters = new Map<MessageChannel, ChannelAdapter>([
      [MessageChannel.WHATSAPP, metaWhatsApp],
      [MessageChannel.EMAIL, email],
    ]);
  }

  getAdapter(channel: MessageChannel, provider?: ChannelProvider): ChannelAdapter | null {
    if (channel === MessageChannel.WHATSAPP || provider === ChannelProvider.META_WHATSAPP) {
      return this.metaWhatsApp;
    }
    return this.adapters.get(channel) ?? null;
  }
}
