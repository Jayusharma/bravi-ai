// outbound-send.service.ts — Validates, creates, queues, and acks outbound messages.
// Called by the socket outbound:send handler. REST shim in OutboundController delegates here too.

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { EnquiryService } from '../enquiry/enquiry.service';
import { OutboundService } from './outbound.service';
import { MessageChannel, DraftStatus } from '@prisma/client';

export interface SendInput {
  enquiryId: string;
  channel?: MessageChannel;
  subject?: string;
  body?: string;
  draftId?: string;
  recipientOverride?: string;
  userId: string;
}

export interface SendResult {
  messageId: string;
  jobId: string;
  deliveryStatus: 'PENDING';
  contactId: string;
}

@Injectable()
export class OutboundSendService {
  private readonly logger = new Logger(OutboundSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enquiryService: EnquiryService,
    private readonly outboundService: OutboundService,
  ) {}

  /** Validates payload, creates PENDING ConversationMessage, queues BullMQ job, returns ack */
  async send(input: SendInput): Promise<SendResult> {
    const { enquiryId, userId, recipientOverride } = input;

    // ── Resolve channel + body from draft if provided ──
    let channel = input.channel;
    let body = input.body ?? '';
    let subject = input.subject;
    let draftId = input.draftId;

    if (draftId) {
      const draft = await this.prisma.outboundDraft.findUnique({
        where: { id: draftId },
        include: { attachments: true },
      });
      if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
      if (draft.createdBy !== userId) throw new BadRequestException('Cannot send another user\'s draft');
      if (draft.status !== DraftStatus.ACTIVE) throw new BadRequestException('Draft is not in ACTIVE state');

      channel = draft.channel;
      body = input.body !== undefined ? input.body : (draft.body ?? '');
      subject = input.subject !== undefined ? input.subject : (draft.subject ?? undefined);

      const hasAttachments = draft.attachments.length > 0;
      if (!body.trim() && !hasAttachments) {
        throw new BadRequestException('Draft has no content and no attachments');
      }
    }

    if (!channel) throw new BadRequestException('channel is required');
    if (!body.trim() && !draftId) throw new BadRequestException('body is required');

    // ── Load enquiry + contact channels ──
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { contact: { include: { channels: true } } },
    });
    if (!enquiry) throw new NotFoundException(`Enquiry ${enquiryId} not found`);

    const contactChannel = enquiry.contact.channels.find((c) => c.channel === channel);
    const to = recipientOverride ?? contactChannel?.identifier;

    if (!to) {
      throw new BadRequestException(
        `Contact has no ${channel} channel. Add a recipientOverride or configure the contact's channel.`,
      );
    }

    // ── Email requires subject ──
    if (channel === MessageChannel.EMAIL && !subject?.trim()) {
      this.logger.warn(`Email sent without subject for enquiry ${enquiryId}`);
    }

    // ── Create ConversationMessage + timeline + state (also emits message.outbound) ──
    const message = await this.enquiryService.addOutboundMessage(enquiryId, {
      channel,
      to,
      subject,
      body,
      userId,
      draftId,
    });

    // ── Transfer draft attachments → ConversationMessage ──
    if (draftId) {
      const draftAttachments = await this.prisma.draftAttachment.findMany({ where: { draftId } });
      if (draftAttachments.length > 0) {
        await this.prisma.messageAttachment.createMany({
          data: draftAttachments.map((da) => ({
            conversationMessageId: message.id,
            kind: da.kind,
            fileName: da.fileName,
            mimeType: da.mimeType,
            fileSize: da.fileSize,
            storageKey: da.storageKey,
            cdnUrl: da.cdnUrl,
            width: da.width,
            height: da.height,
            durationMs: da.durationMs,
          })),
        });
      }

      await this.prisma.outboundDraft.update({
        where: { id: draftId },
        data: { status: DraftStatus.CLEARED },
      });
    }

    // ── Directly queue via enqueue() — idempotency guard in handleOutbound prevents double-queue ──
    const { jobId } = await this.outboundService.enqueue({
      messageId: message.id,
      enquiryId,
      channel,
      to,
      content: body,
      subject,
      fromUserId: userId,
    });

    if (jobId) {
      await this.prisma.conversationMessage.update({
        where: { id: message.id },
        data: { queueJobId: jobId },
      });
    }

    this.logger.log(`📤 Sent message ${message.id} (jobId: ${jobId}) for enquiry ${enquiryId}`);

    return {
      messageId: message.id,
      jobId,
      deliveryStatus: 'PENDING',
      contactId: enquiry.contactId,
    };
  }
}
