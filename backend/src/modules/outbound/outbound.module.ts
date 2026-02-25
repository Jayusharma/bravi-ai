import { Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
// import { EmailAdapter } from './adapters/email.adapter';
// import { DeliveryTrackingService } from './delivery/delivery-tracking.service';

@Module({
  providers: [
    OutboundService,
    ChannelRouterService,
    WhatsAppAdapter,
    // EmailAdapter,
    // DeliveryTrackingService,
  ],
  exports: [OutboundService, ChannelRouterService],
})
export class OutboundModule {}