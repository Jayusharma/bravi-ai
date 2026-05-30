// outbound.module.ts — Outbound messaging module: send pipeline, drafts, delivery tracking, DLQ.

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboundService } from './outbound.service';
import { OutboundController } from './outbound.controller';
import { DraftController } from './draft.controller';
import { DraftService } from './draft.service';
import { MessageController } from './message.controller';
import { OutboundSendService } from './outbound-send.service';
import { OutboundProcessor, OUTBOUND_QUEUE } from './outbound.processor';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { DeliveryTrackingService } from './delivery/delivery-tracking.service';
import { TemplateStubService, TEMPLATE_SERVICE } from './templates/template.stub';
import { AdapterFactory } from './adapter.factory';
import { WhatsAppWindowService } from './whatsapp-window.service';
import { DlqService } from './dlq/dlq.service';
import { DlqController } from './dlq/dlq.controller';
import { EnquiryModule } from '../enquiry/enquiry.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: OUTBOUND_QUEUE }),
    EnquiryModule,
    StorageModule,
  ],
  providers: [
    DraftService,
    OutboundSendService,
    OutboundService,
    OutboundProcessor,
    AdapterFactory,
    WhatsAppWindowService,
    DlqService,
    ChannelRouterService,
    WhatsAppAdapter,
    EmailAdapter,
    DeliveryTrackingService,
    { provide: TEMPLATE_SERVICE, useClass: TemplateStubService },
  ],
  controllers: [OutboundController, DraftController, MessageController, DlqController],
  exports: [DraftService, OutboundSendService, OutboundService, ChannelRouterService, WhatsAppWindowService],
})
export class OutboundModule {}
