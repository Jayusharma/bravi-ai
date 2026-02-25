import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelRouterService } from './channel-router.service';
import { MessageChannel, DeliveryStatus } from '@prisma/client';

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private prisma: PrismaService,
    private channelRouter: ChannelRouterService,
  ) {}

  /**
   * LISTENER: When EnquiryService creates an outbound ConversationMessage,
   * this event fires to actually SEND it via the channel adapter.
   */
  @OnEvent('message.outbound')
  async handleOutbound(payload: {
    messageId: string;
    enquiryId: string;
    channel: MessageChannel;
    to: string;
    content: string;
    subject?: string;
  }): Promise<void> {
    const { messageId, channel, to, content, subject } = payload;

    if (!to) {
      this.logger.error(`No recipient for message ${messageId} — cannot send`);
      await this.updateDeliveryStatus(messageId, DeliveryStatus.FAILED);
      return;
    }

    this.logger.log(`📤 Sending ${channel} message ${messageId} → ${to}`);

    const result = await this.channelRouter.send(channel, {
      to,
      content,
      subject,
    });

    if (result.success) {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          externalId: result.externalId,
        },
      });
      this.logger.log(`✅ Message ${messageId} sent. ExternalId: ${result.externalId}`);
    } else {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });
      this.logger.error(`❌ Message ${messageId} failed: ${result.error}`);
    }
  }

  /**
   * Update delivery status from webhook callbacks.
   * Called when WhatsApp/SendGrid sends us a delivery receipt.
   */
  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
  ): Promise<void> {
    const data: any = { deliveryStatus: status };

    if (status === DeliveryStatus.DELIVERED) {
      data.deliveredAt = new Date();
    }
    if (status === DeliveryStatus.READ) {
      data.readAt = new Date();
    }

    await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data,
    });
  }
}