import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from 'src/database/prisma.service';
import { DeliveryStatus, MessageChannel } from '@prisma/client';
import {
  OUTBOUND_QUEUE,
  JOB_EMAIL,
  JOB_WHATSAPP,
  EmailJobPayload,
  WhatsAppJobPayload,
} from './outbound.processor';

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(OUTBOUND_QUEUE) private readonly outboundQueue: Queue,
  ) {}

  /**
   * LISTENER: When EnquiryService creates an outbound ConversationMessage,
   * this event enqueues a BullMQ job instead of sending synchronously.
   */
  @OnEvent('message.outbound')
  async handleOutbound(payload: {
    messageId: string;
    enquiryId: string;
    channel: MessageChannel;
    to: string;
    content: string;
    subject?: string;
    fromUserId?: string;
  }): Promise<void> {
    const { messageId, enquiryId, channel, to, content, subject, fromUserId = 'SYSTEM' } = payload;
    try {
      if (!to) {
        this.logger.error(`No recipient for message ${messageId} — marking FAILED`);
        await this.prisma.conversationMessage.update({
          where: { id: messageId },
          data: { deliveryStatus: DeliveryStatus.FAILED },
        });
        return;
      }

      // Fetch attachments for this message to include in the job payload
      const msgAttachments = await this.prisma.messageAttachment.findMany({
        where: { conversationMessageId: messageId },
        select: { cdnUrl: true, fileName: true, mimeType: true, fileSize: true },
      });
      const attachments = msgAttachments
        .filter((a) => a.cdnUrl)
        .map((a) => ({ cdnUrl: a.cdnUrl!, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize }));

      if (channel === MessageChannel.EMAIL) {
        const jobPayload: EmailJobPayload = { messageId, enquiryId, to, subject, body: content, fromUserId, attachments };
        await this.outboundQueue.add(JOB_EMAIL, jobPayload, JOB_OPTIONS);
        this.logger.log(`📬 Enqueued email job for message ${messageId} → ${to} (${attachments.length} attachment(s))`);
      } else if (channel === MessageChannel.WHATSAPP) {
        const jobPayload: WhatsAppJobPayload = { messageId, enquiryId, to, body: content, fromUserId, attachments };
        await this.outboundQueue.add(JOB_WHATSAPP, jobPayload, JOB_OPTIONS);
        this.logger.log(`📬 Enqueued WhatsApp job for message ${messageId} → ${to} (${attachments.length} attachment(s))`);
      } else {
        this.logger.warn(`Unsupported channel ${channel} for message ${messageId}`);
        await this.prisma.conversationMessage.update({
          where: { id: messageId },
          data: { deliveryStatus: DeliveryStatus.FAILED },
        });
      }
    } catch (err: any) {
      this.logger.error(`handleOutbound failed for message ${messageId}: ${err.message}`, err.stack);
      // Best-effort: mark message failed so the UI shows the error state
      try {
        await this.prisma.conversationMessage.update({
          where: { id: messageId },
          data: { deliveryStatus: DeliveryStatus.FAILED },
        });
      } catch {
        // ignore secondary failure
      }
    }
  }

  /**
   * Re-enqueue a FAILED message for manual retry.
   */
  async retryMessage(messageId: string): Promise<void> {
    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { enquiry: { include: { contact: { include: { channels: true } } } } },
    });

    if (!msg) throw new BadRequestException(`Message ${messageId} not found`);
    if (msg.deliveryStatus !== DeliveryStatus.FAILED) {
      throw new BadRequestException(`Message ${messageId} is not in FAILED state`);
    }

    // Reset to PENDING
    await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: DeliveryStatus.PENDING },
    });

    // Re-emit to trigger the normal queue path
    await this.handleOutbound({
      messageId,
      enquiryId: msg.enquiryId,
      channel: msg.channel,
      to: msg.to ?? '',
      content: msg.content,
      subject: msg.subject ?? undefined,
      fromUserId: msg.sentByUserId ?? 'SYSTEM',
    });

    this.logger.log(`🔄 Retry queued for message ${messageId}`);
  }

  /**
   * Update delivery status by provider's external message ID (for webhook callbacks).
   */
  async updateDeliveryStatusByExternalId(
    externalId: string,
    status: DeliveryStatus,
  ): Promise<void> {
    const msg = await this.prisma.conversationMessage.findFirst({
      where: { externalId },
    });
    if (!msg) {
      this.logger.warn(`No message found with externalId: ${externalId}`);
      return;
    }
    await this.updateDeliveryStatus(msg.id, status, msg.enquiryId);
  }

  /**
   * Update delivery status from provider webhook callbacks (Twilio / SendGrid).
   */
  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    enquiryId?: string,
  ): Promise<void> {
    // Prevent status regression: SENT→DELIVERED→READ is the only valid progression.
    // Out-of-order webhooks (e.g. Twilio re-delivering a stale DELIVERED after READ)
    // must not downgrade the current status.
    const STATUS_RANK: Record<string, number> = {
      PENDING: 0,
      SENT: 1,
      DELIVERED: 2,
      READ: 3,
      FAILED: -1,
    };
    const incomingRank = STATUS_RANK[status] ?? 0;
    const lowerStatuses = (Object.keys(STATUS_RANK) as DeliveryStatus[]).filter(
      (s) => (STATUS_RANK[s] ?? 0) < incomingRank,
    );

    const data: { deliveryStatus: DeliveryStatus; deliveredAt?: Date; readAt?: Date } = {
      deliveryStatus: status,
    };

    if (status === DeliveryStatus.DELIVERED) data.deliveredAt = new Date();
    if (status === DeliveryStatus.READ) data.readAt = new Date();

    // Only update if current status is lower than incoming (prevents regression)
    const updated = await this.prisma.conversationMessage.updateMany({
      where: {
        id: messageId,
        deliveryStatus: lowerStatuses.length > 0 ? { in: lowerStatuses } : undefined,
      },
      data,
    });

    if (updated.count === 0) {
      this.logger.debug(`⏭️  Status ${status} ignored for ${messageId} — already at higher rank`);
      return;
    }

    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });

    this.logger.log(`📦 Delivery status updated: ${messageId} → ${status}`);

    const eid = enquiryId ?? msg?.enquiryId;
    this.eventEmitter.emit('outbound.delivery_updated', {
      messageId,
      enquiryId: eid,
      deliveryStatus: status,
      deliveredAt: data.deliveredAt,
      readAt: data.readAt,
    });
  }
}