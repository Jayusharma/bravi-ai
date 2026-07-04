// adapter.factory.ts — Returns the correct channel adapter for an outbound send.
//
// Selection is provider-first: if the active ChannelConnection says META_WHATSAPP, the Meta
// adapter wins. With no connection (or a provider without its own adapter, e.g. Twilio) we
// fall back to the per-channel default — exactly the pre-connections behavior.

import { Injectable } from '@nestjs/common';
import { ChannelProvider, MessageChannel } from '@prisma/client';
import { ChannelAdapter } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { MetaWhatsAppAdapter } from './adapters/meta-whatsapp.adapter';

@Injectable()
export class AdapterFactory {
  private readonly adapters: Map<MessageChannel, ChannelAdapter>;

  constructor(
    private readonly whatsapp: WhatsAppAdapter,
    private readonly email: EmailAdapter,
    private readonly metaWhatsApp: MetaWhatsAppAdapter,
  ) {
    // Channel defaults — used when no connection exists for the channel
    this.adapters = new Map<MessageChannel, ChannelAdapter>([
      [MessageChannel.WHATSAPP, whatsapp], // Twilio (env-configured)
      [MessageChannel.EMAIL, email],
    ]);
  }

  /**
   * Returns the adapter for the given channel, or null if unsupported.
   * `provider` comes from the active ChannelConnection (when one exists) and overrides
   * the channel default — this is how Meta and Twilio WhatsApp coexist.
   */
  getAdapter(channel: MessageChannel, provider?: ChannelProvider): ChannelAdapter | null {
    if (provider === ChannelProvider.META_WHATSAPP) return this.metaWhatsApp;
    return this.adapters.get(channel) ?? null;
  }
}
