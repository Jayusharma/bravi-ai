import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboundService } from './outbound.service';
import { OutboundController } from './outbound.controller';
import { OutboundGateway } from './outbound.gateway';
import { OutboundProcessor, OUTBOUND_QUEUE } from './outbound.processor';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { DeliveryTrackingService } from './delivery/delivery-tracking.service';
import { TemplateStubService, TEMPLATE_SERVICE } from './templates/template.stub';
import { EnquiryModule } from '../enquiry/enquiry.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: OUTBOUND_QUEUE }),
    EnquiryModule,
    StorageModule,
  ],
  providers: [
    OutboundService,
    OutboundGateway,
    OutboundProcessor,
    ChannelRouterService,
    WhatsAppAdapter,
    EmailAdapter,
    DeliveryTrackingService,
    { provide: TEMPLATE_SERVICE, useClass: TemplateStubService },
  ],
  controllers: [OutboundController],
  exports: [OutboundService, ChannelRouterService],
})
export class OutboundModule {}
