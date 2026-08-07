import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { IngestMessageDto } from './dto/incoming-message.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContactService } from '../contact/contact.service';
import { InboundMessage } from '@prisma/client';
import { nextContactSeq } from 'src/common/utils/conversation-seq.util';

// ── How many days after CLOSED_LOST before we create
//    a new enquiry vs reopen the old one ──
const REOPEN_WINDOW_DAYS = 30;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('qualification') private qualificationQueue: Queue,
    private contactService: ContactService,
    private eventEmitter: EventEmitter2,
  ) { }

  async ingest(dto: IngestMessageDto): Promise<InboundMessage> {
    // ── Step 1: Resolve contact (find or create) ──
    const { contactId, isNew } = await this.contactService.resolve(
      dto.channel,
      dto.from,
      dto.displayName,
    );

    if (!isNew) {
      // ── Step 2: Check for ACTIVE enquiry ──
      const activeEnquiry = await this.prisma.enquiry.findFirst({
        where: {
          contactId,
          status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (activeEnquiry) {
        // ════════════════════════════════════════════════
        // PATH A: FAST PATH — Known contact + open enquiry
        // Skip qualification, just append the message
        // ════════════════════════════════════════════════
        return this.appendToExistingEnquiry(dto, contactId, activeEnquiry);
      }

      // ── Step 3: Check for recently CLOSED enquiry ──
      const lastClosedEnquiry = await this.prisma.enquiry.findFirst({
        where: {
          contactId,
          status: { in: ['CONVERTED', 'CLOSED_LOST'] },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (lastClosedEnquiry) {
        const daysSinceClosed = this.daysBetween(
          lastClosedEnquiry.updatedAt,
          new Date(),
        );

        if (
          lastClosedEnquiry.status === 'CLOSED_LOST' &&
          daysSinceClosed <= REOPEN_WINDOW_DAYS
        ) {
          // ════════════════════════════════════════════════
          // PATH B: REOPEN — Closed lost within 30 days
          // Customer reconsidered! Reopen the old enquiry.
          // ════════════════════════════════════════════════
          return this.reopenClosedEnquiry(
            dto,
            contactId,
            lastClosedEnquiry,
            daysSinceClosed,
          );
        }

        // PATH C: CONVERTED (any time) or CLOSED_LOST > 30 days
        // → Falls to SLOW PATH below (qualify, then create new enquiry)
      }

      // PATH D: Known contact, first message was spam (no enquiry exists)
      // → Falls to SLOW PATH below
    }

    // ════════════════════════════════════════════════
    // SLOW PATH: Needs AI qualification
    //   - New contact (never messaged before)
    //   - Known contact, all enquiries closed > 30 days
    //   - Known contact, previously marked SPAM
    //   - CONVERTED customer coming back (new need)
    // ════════════════════════════════════════════════
    return this.queueForQualification(dto, contactId);
  }

  // ═══════════════════════════════════════════════════════════
  // PATH A: Append to active enquiry (instant — no AI needed)
  // ═══════════════════════════════════════════════════════════

  private async appendToExistingEnquiry(
    dto: IngestMessageDto,
    contactId: string,
    enquiry: { id: string; status: string },
  ): Promise<InboundMessage> {
    // 1. Save raw inbound message (audit trail)
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        status: 'REAL_ENQUIRY',
        contactId,
      },
    });

    // 2. Create ConversationMessage (what the chat view shows) + 3. status transition,
    //    atomically: the seq increment and the message insert must live or die together.
    const statusUpdate = this.getStatusTransition(enquiry.status);

    const conversationMessage = await this.prisma.$transaction(async (tx) => {
      const seq = await nextContactSeq(tx, contactId);
      const message = await tx.conversationMessage.create({
        data: {
          enquiryId: enquiry.id,
          contactId,
          seq,
          channel: dto.channel,
          direction: 'INBOUND',
          from: dto.from,
          to: dto.to,
          subject: dto.subject,
          content: dto.body,
          deliveryStatus: 'DELIVERED',
        },
      });

      await tx.enquiry.update({
        where: { id: enquiry.id },
        data: {
          lastCustomerReplyAt: new Date(),
          lastActivityAt: new Date(),
          ...statusUpdate,
        },
      });

      return message;
    });

    // 4. Emit for WebSocket (uses ConversationMessage ID, not InboundMessage ID)
    this.eventEmitter.emit('message.inbound.appended', {
      contactId,
      enquiryId: enquiry.id,
      message: {
        id: conversationMessage.id,
        enquiryId: enquiry.id,
        contactId: conversationMessage.contactId,
        seq: conversationMessage.seq,
        clientMessageId: conversationMessage.clientMessageId,
        channel: dto.channel,
        direction: 'INBOUND',
        from: dto.from,
        to: dto.to,
        content: dto.body,
        deliveryStatus: null,
        createdAt: conversationMessage.createdAt,
        sentByUser: null,
      },
    });

    this.logger.log(
      `📨 PATH A: Appended to enquiry ${enquiry.id}` +
      (statusUpdate.status
        ? ` (auto-transition: ${enquiry.status} → ${statusUpdate.status})`
        : ''),
    );

    return inboundMessage;
  }

  // ═══════════════════════════════════════════════════════════
  // PATH B: Reopen closed-lost enquiry (within 30-day window)
  // ═══════════════════════════════════════════════════════════

  private async reopenClosedEnquiry(
    dto: IngestMessageDto,
    contactId: string,
    closedEnquiry: { id: string; status: string },
    daysSinceClosed: number,
  ): Promise<InboundMessage> {
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        status: 'REAL_ENQUIRY',
        contactId,
      },
    });

    const conversationMessage = await this.prisma.$transaction(async (tx) => {
      const seq = await nextContactSeq(tx, contactId);
      const message = await tx.conversationMessage.create({
        data: {
          enquiryId: closedEnquiry.id,
          contactId,
          seq,
          channel: dto.channel,
          direction: 'INBOUND',
          from: dto.from,
          to: dto.to,
          subject: dto.subject,
          content: dto.body,
          deliveryStatus: 'DELIVERED',
        },
      });

      // Reopen the enquiry + add timeline entry
      await tx.enquiry.update({
        where: { id: closedEnquiry.id },
        data: {
          status: 'OPEN',
          lastActivityAt: new Date(),
          lastCustomerReplyAt: new Date(),
          version: { increment: 1 },
          timeline: {
            create: {
              type: 'REOPENED',
              fromStatus: 'CLOSED_LOST',
              toStatus: 'OPEN',
              createdBy: 'SYSTEM',
              metadata: {
                reason: `Customer messaged again within ${REOPEN_WINDOW_DAYS}-day window`,
                daysSinceClosed,
              },
            },
          },
        },
      });

      return message;
    });

    // Emit for WebSocket
    this.eventEmitter.emit('message.inbound.appended', {
      contactId,
      enquiryId: closedEnquiry.id,
      message: {
        id: conversationMessage.id,
        enquiryId: closedEnquiry.id,
        contactId: conversationMessage.contactId,
        seq: conversationMessage.seq,
        clientMessageId: conversationMessage.clientMessageId,
        channel: dto.channel,
        direction: 'INBOUND',
        from: dto.from,
        to: dto.to,
        content: dto.body,
        deliveryStatus: null,
        createdAt: conversationMessage.createdAt,
        sentByUser: null,
      },
    });

    this.logger.log(
      `🔁 PATH B: Reopened enquiry ${closedEnquiry.id} (was CLOSED_LOST ${daysSinceClosed} days ago)`,
    );

    return inboundMessage;
  }

  // ═══════════════════════════════════════════════════════════
  // SLOW PATH: Queue for AI qualification
  // ═══════════════════════════════════════════════════════════

  private async queueForQualification(
    dto: IngestMessageDto,
    contactId: string,
  ): Promise<InboundMessage> {
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        status: 'PENDING',
        contactId,
      },
    });

    await this.qualificationQueue.add(
      'qualify',
      { inboundMessageId: inboundMessage.id },
      {
        jobId: `qualify-${inboundMessage.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );

    this.logger.log(
      `📨 SLOW PATH: ${inboundMessage.id} → queued for qualification`,
    );

    return inboundMessage;
  }

  // ═══════════════════════════════════════════════════════════
  // Smart auto-transitions when customer replies
  //
  //   STALE → OPEN              (customer came back)
  //   AWAITING_CUSTOMER → IN_PROGRESS  (customer answered)
  //   QUOTATION_SENT → IN_PROGRESS     (responded to quote)
  //   FOLLOW_UP → IN_PROGRESS          (follow-up worked)
  // ═══════════════════════════════════════════════════════════

  private getStatusTransition(
    currentStatus: string,
  ): Record<string, any> {
    const transitions: Record<string, string> = {
      STALE: 'OPEN',
      AWAITING_CUSTOMER: 'IN_PROGRESS',
      QUOTATION_SENT: 'IN_PROGRESS',
      FOLLOW_UP: 'IN_PROGRESS',
    };

    const newStatus = transitions[currentStatus];
    if (!newStatus) return {};
    return { status: newStatus };
  }

  private daysBetween(date1: Date, date2: Date): number {
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}