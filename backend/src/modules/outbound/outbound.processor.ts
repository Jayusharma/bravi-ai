import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeliveryStatus, MessageChannel } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'src/database/prisma.service';
import { ChannelRouterService } from './channel-router.service';
import { EnquiryService } from '../enquiry/enquiry.service';

export interface JobAttachment {
  cdnUrl: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface EmailJobPayload {
  messageId: string;
  enquiryId: string;
  to: string;
  subject?: string;
  body: string;
  fromUserId: string;
  attachments?: JobAttachment[];
}

export interface WhatsAppJobPayload {
  messageId: string;
  enquiryId: string;
  to: string;
  body: string;
  fromUserId: string;
  attachments?: JobAttachment[];
}

export const OUTBOUND_QUEUE = 'OUTBOUND_QUEUE';
export const JOB_EMAIL = 'outbound:email';
export const JOB_WHATSAPP = 'outbound:whatsapp';

@Processor(OUTBOUND_QUEUE, {
  concurrency: parseInt(process.env.OUTBOUND_WORKER_CONCURRENCY ?? '5', 10),
  limiter: { max: 10, duration: 1000 },  // conservative limit safe for WhatsApp (10/s)
  settings: {
    backoffStrategy: (attemptsMade: number): number =>
      ([1000, 4000, 16000][attemptsMade - 1] ?? 16000),
  },
})
export class OutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelRouter: ChannelRouterService,
    private readonly eventEmitter: EventEmitter2,
    private readonly enquiryService: EnquiryService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload | WhatsAppJobPayload>): Promise<void> {
    switch (job.name) {
      case JOB_EMAIL:
        await this.handleEmail(job as Job<EmailJobPayload>);
        break;
      case JOB_WHATSAPP:
        await this.handleWhatsApp(job as Job<WhatsAppJobPayload>);
        break;
      default:
        this.logger.warn(`Unknown outbound job name: ${job.name}`);
    }
  }

  /**
   * Called by BullMQ after ALL retry attempts are exhausted.
   * Marks the message FAILED, inserts an OutboundDeadLetter row, and emits outbound.failed.
   */
  @OnWorkerEvent('failed')
  async onJobFailed(job: Job<EmailJobPayload | WhatsAppJobPayload>, error: Error) {
    const { messageId, enquiryId } = job.data;
    this.logger.error(`💀 Job ${job.id} failed permanently after ${job.attemptsMade} attempts: ${error.message}`);

    try {
      const failReason = error.message ?? 'Delivery failed after all retry attempts.';

      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DeliveryStatus.FAILED, failReason },
      });

      // Insert dead letter row (upsert in case onJobFailed fires twice — e.g. from a crash)
      await this.prisma.outboundDeadLetter.upsert({
        where: { conversationMessageId: messageId },
        create: {
          conversationMessageId: messageId,
          jobName: job.name,
          payload: job.data as any,
          lastError: failReason,
          attemptCount: job.attemptsMade,
        },
        update: {
          lastError: failReason,
          attemptCount: job.attemptsMade,
          resolvedAt: null,
          resolvedBy: null,
        },
      });

      this.eventEmitter.emit('outbound.failed', {
        messageId,
        enquiryId,
        error: error.message,
        failReason,
        attemptCount: job.attemptsMade,
      });
    } catch (err: any) {
      this.logger.error(`Failed to handle permanent failure for message ${messageId}: ${err.message}`);
    }
  }

  private async handleEmail(job: Job<EmailJobPayload>): Promise<void> {
    const { messageId, enquiryId, to, subject, body, attachments } = job.data;

    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
    });
    if (!msg || msg.deliveryStatus !== DeliveryStatus.PENDING) {
      this.logger.warn(`Email job ${job.id}: message ${messageId} not in PENDING state — skipping`);
      return;
    }

    this.logger.log(`📧 Processing email job ${job.id} → ${to} (${attachments?.length ?? 0} attachment(s))`);

    const result = await this.channelRouter.send(MessageChannel.EMAIL, {
      to,
      content: body,
      subject,
      attachments,
    });

    await this.updateAndEmit(messageId, enquiryId, result, job.attemptsMade + 1);
  }

  private async handleWhatsApp(job: Job<WhatsAppJobPayload>): Promise<void> {
    const { messageId, enquiryId, to, body, attachments } = job.data;

    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
    });
    if (!msg || msg.deliveryStatus !== DeliveryStatus.PENDING) {
      this.logger.warn(`WhatsApp job ${job.id}: message ${messageId} not in PENDING state — skipping`);
      return;
    }

    this.logger.log(`📱 Processing WhatsApp job ${job.id} → ${to} (${attachments?.length ?? 0} attachment(s))`);

    const result = await this.channelRouter.send(MessageChannel.WHATSAPP, {
      to,
      content: body,
      attachments,
    });

    await this.updateAndEmit(messageId, enquiryId, result, job.attemptsMade + 1);
  }

  private async updateAndEmit(
    messageId: string,
    enquiryId: string,
    result: { success: boolean; externalId?: string; error?: string },
    attemptCount: number,
  ): Promise<void> {
    if (result.success) {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          externalId: result.externalId,
        },
      });
      this.eventEmitter.emit('outbound.sent', { messageId, enquiryId, sentAt: new Date() });
      this.logger.log(`✅ Message ${messageId} sent. ExternalId: ${result.externalId}`);
      // Fire-and-forget — state machine transition, non-critical
      this.enquiryService.maybeTransitionOnOutbound(enquiryId).catch((err) =>
        this.logger.warn(`State transition failed for enquiry ${enquiryId}: ${err.message}`),
      );
    } else {
      const isPermanent = result.error?.includes('not configured');

      if (isPermanent) {
        // Config problem — retrying won't help. Mark FAILED now.
        await this.prisma.conversationMessage.update({
          where: { id: messageId },
          data: { deliveryStatus: DeliveryStatus.FAILED },
        });
        this.eventEmitter.emit('outbound.failed', {
          messageId,
          enquiryId,
          error: result.error,
          attemptCount,
        });
        this.logger.error(`❌ Message ${messageId} failed permanently (not configured): ${result.error}`);
      } else {
        // Transient failure — throw so BullMQ retries with exponential backoff.
        // Message stays PENDING until all retries exhausted.
        this.logger.warn(`⚠️ Message ${messageId} attempt ${attemptCount} failed: ${result.error} — retrying`);
        throw new Error(result.error ?? 'Send failed');
      }
    }
  }
}
