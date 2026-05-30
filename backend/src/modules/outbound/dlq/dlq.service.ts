// dlq.service.ts — Dead letter queue management: list failed messages, retry, discard.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeliveryStatus } from '@prisma/client';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Lists all unresolved dead-letter entries, newest first */
  async listFailed(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.outboundDeadLetter.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.outboundDeadLetter.count({ where: { resolvedAt: null } }),
    ]);
    return { items, total, page, limit };
  }

  /** Re-queues a dead-letter message: resets delivery status and re-emits the outbound event */
  async retryFromDlq(dlqId: string, adminUserId: string): Promise<{ queued: boolean }> {
    const dlq = await this.prisma.outboundDeadLetter.findUnique({ where: { id: dlqId } });
    if (!dlq) throw new NotFoundException(`Dead letter entry ${dlqId} not found`);

    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: dlq.conversationMessageId },
    });
    if (!msg) throw new NotFoundException(`Message ${dlq.conversationMessageId} not found`);

    // Reset message state for retry
    await this.prisma.conversationMessage.update({
      where: { id: msg.id },
      data: {
        deliveryStatus: DeliveryStatus.PENDING,
        queueJobId: null,
        failReason: null,
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    // Re-emit to trigger the queue path
    this.eventEmitter.emit('message.outbound', {
      messageId: msg.id,
      enquiryId: msg.enquiryId,
      channel: msg.channel,
      to: msg.to ?? '',
      content: msg.content,
      subject: msg.subject ?? undefined,
      fromUserId: msg.sentByUserId ?? 'SYSTEM',
    });

    // Mark as resolved
    await this.prisma.outboundDeadLetter.update({
      where: { id: dlqId },
      data: { resolvedAt: new Date(), resolvedBy: adminUserId },
    });

    this.logger.log(`🔄 DLQ retry: admin ${adminUserId} re-queued message ${msg.id} (dlq: ${dlqId})`);
    return { queued: true };
  }

  /** Permanently discards a dead-letter entry (does not retry the message) */
  async discard(dlqId: string, adminUserId: string): Promise<void> {
    const dlq = await this.prisma.outboundDeadLetter.findUnique({ where: { id: dlqId } });
    if (!dlq) throw new NotFoundException(`Dead letter entry ${dlqId} not found`);

    await this.prisma.outboundDeadLetter.update({
      where: { id: dlqId },
      data: { resolvedAt: new Date(), resolvedBy: adminUserId },
    });

    this.logger.log(`🗑️  DLQ discard: admin ${adminUserId} discarded entry ${dlqId}`);
  }
}
