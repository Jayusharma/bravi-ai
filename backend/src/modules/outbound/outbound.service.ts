// outbound.service.ts — BullMQ queue management and delivery status tracking for outbound messages.

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
  backoff: { type: 'custom' as const },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50 },
};

interface EnqueuePayload {
  messageId: string;
  enquiryId: string;
  channel: MessageChannel;
  to: string;
  content: string;
  subject?: string;
  fromUserId?: string;
}

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(OUTBOUND_QUEUE) private readonly outboundQueue: Queue,
  ) {}

  // ─── QUEUE MANAGEMENT ────────────────────────────────────────────────────

  /**
   * Queues an outbound BullMQ job, returns the job ID.
   * Called directly by OutboundSendService (via socket path) and internally by handleOutbound.
   */
  async enqueue(payload: EnqueuePayload): Promise<{ jobId: string }> {
    const { messageId, enquiryId, channel, to, content, subject, fromUserId = 'SYSTEM' } = payload;

    if (!to) {
      this.logger.error(`No recipient for message ${messageId} — marking FAILED`);
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });
      return { jobId: '' };
    }

    const msgAttachments = await this.prisma.messageAttachment.findMany({
      where: { conversationMessageId: messageId },
      select: { cdnUrl: true, fileName: true, mimeType: true, fileSize: true },
    });
    const attachments = msgAttachments
      .filter((a) => a.cdnUrl)
      .map((a) => ({ cdnUrl: a.cdnUrl!, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize }));

    let job: any;

    if (channel === MessageChannel.EMAIL) {
      const jobPayload: EmailJobPayload = { messageId, enquiryId, to, subject, body: content, fromUserId, attachments };
      job = await this.outboundQueue.add(JOB_EMAIL, jobPayload, JOB_OPTIONS);
      this.logger.log(`📬 Enqueued email job ${job.id} for message ${messageId} → ${to}`);
    } else if (channel === MessageChannel.WHATSAPP) {
      const jobPayload: WhatsAppJobPayload = { messageId, enquiryId, to, body: content, fromUserId, attachments };
      job = await this.outboundQueue.add(JOB_WHATSAPP, jobPayload, JOB_OPTIONS);
      this.logger.log(`📬 Enqueued WhatsApp job ${job.id} for message ${messageId} → ${to}`);
    } else {
      this.logger.warn(`Unsupported channel ${channel} for message ${messageId}`);
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });
      return { jobId: '' };
    }

    return { jobId: job.id as string };
  }

  /**
   * Event listener: fires when EnquiryService creates an outbound ConversationMessage.
   * Idempotency guard: skips if the message is already queued (queueJobId set).
   * This allows OutboundSendService to queue directly via enqueue() without double-queuing.
   */
  @OnEvent('message.outbound')
  async handleOutbound(payload: EnqueuePayload): Promise<void> {
    const { messageId } = payload;
    try {
      // Skip if already queued by OutboundSendService.send() (socket path)
      const msg = await this.prisma.conversationMessage.findUnique({
        where: { id: messageId },
        select: { queueJobId: true },
      });
      if (msg?.queueJobId) {
        this.logger.debug(`Message ${messageId} already queued (jobId: ${msg.queueJobId}) — skipping`);
        return;
      }

      const { jobId } = await this.enqueue(payload);
      if (jobId) {
        await this.prisma.conversationMessage.update({
          where: { id: messageId },
          data: { queueJobId: jobId },
        });
      }
    } catch (err: any) {
      this.logger.error(`handleOutbound failed for message ${messageId}: ${err.message}`, err.stack);
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

  // ─── RETRY ───────────────────────────────────────────────────────────────

  /** Re-queues a permanently FAILED message for manual retry */
  async retryMessage(messageId: string): Promise<{ jobId: string }> {
    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { enquiry: { include: { contact: { include: { channels: true } } } } },
    });

    if (!msg) throw new BadRequestException(`Message ${messageId} not found`);
    if (msg.deliveryStatus !== DeliveryStatus.FAILED) {
      throw new BadRequestException(`Message ${messageId} is not in FAILED state`);
    }

    await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: DeliveryStatus.PENDING, queueJobId: null, retryCount: { increment: 1 }, lastRetryAt: new Date() },
    });

    const { jobId } = await this.enqueue({
      messageId,
      enquiryId: msg.enquiryId,
      channel: msg.channel,
      to: msg.to ?? '',
      content: msg.content,
      subject: msg.subject ?? undefined,
      fromUserId: msg.sentByUserId ?? 'SYSTEM',
    });

    if (jobId) {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { queueJobId: jobId },
      });
    }

    this.logger.log(`🔄 Retry queued (jobId: ${jobId}) for message ${messageId}`);
    return { jobId };
  }

  // ─── DELIVERY STATUS ─────────────────────────────────────────────────────

  /** Updates delivery status by provider's external message ID (for webhook callbacks) */
  async updateDeliveryStatusByExternalId(
    externalId: string,
    status: DeliveryStatus,
    failReason?: string,
  ): Promise<void> {
    const msg = await this.prisma.conversationMessage.findFirst({ where: { externalId } });
    if (!msg) {
      this.logger.warn(`No message found with externalId: ${externalId}`);
      return;
    }
    await this.updateDeliveryStatus(msg.id, status, msg.enquiryId, failReason);
  }

  /** Updates delivery status; prevents regression (SENT → DELIVERED → READ only) */
  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    enquiryId?: string,
    failReason?: string,
  ): Promise<void> {
    const STATUS_RANK: Record<string, number> = {
      PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: -1,
    };
    const incomingRank = STATUS_RANK[status] ?? 0;
    const lowerStatuses = (Object.keys(STATUS_RANK) as DeliveryStatus[]).filter(
      (s) => (STATUS_RANK[s] ?? 0) < incomingRank,
    );

    const data: {
      deliveryStatus: DeliveryStatus;
      deliveredAt?: Date;
      readAt?: Date;
      failReason?: string;
    } = { deliveryStatus: status };

    if (status === DeliveryStatus.DELIVERED) data.deliveredAt = new Date();
    if (status === DeliveryStatus.READ) data.readAt = new Date();
    if (status === DeliveryStatus.FAILED && failReason) data.failReason = failReason;

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
      failReason,
    });
  }
}
