// outbound-send.service.ts — Validates, creates, queues, and acks outbound messages.
// Called by the socket outbound:send handler. REST shim in OutboundController delegates here too.

import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    private readonly eventEmitter: EventEmitter2,
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
      if (draft.createdBy !== userId) throw new ForbiddenException('Cannot send another user\'s draft');
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

  /**
   * Forwards an existing message into another conversation.
   * Creates a NEW outbound message in the target enquiry, copying the source
   * message's text + attachments, then queues it through the normal send pipeline.
   */
  async forward(input: {
    sourceMessageId: string;
    targetEnquiryId: string;
    userId: string;
  }): Promise<SendResult> {
    const { sourceMessageId, targetEnquiryId, userId } = input;

    // ── Load source message + attachments ──
    const source = await this.prisma.conversationMessage.findUnique({
      where: { id: sourceMessageId },
      include: { attachments: true },
    });
    if (!source) throw new NotFoundException(`Message ${sourceMessageId} not found`);
    if (source.isDeleted) throw new BadRequestException('Cannot forward a deleted message');
    if (!source.content?.trim() && source.attachments.length === 0) {
      throw new BadRequestException('Message has no content or attachments to forward');
    }

    // ── Load target enquiry + contact channels ──
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: targetEnquiryId },
      include: { contact: { include: { channels: true } } },
    });
    if (!enquiry) throw new NotFoundException(`Enquiry ${targetEnquiryId} not found`);

    // Prefer the source channel if the target contact has it, else the first channel.
    const channels = enquiry.contact.channels;
    const matching = channels.find((c) => c.channel === source.channel);
    const contactChannel = matching ?? channels[0];
    if (!contactChannel) {
      throw new BadRequestException(
        'Target contact has no channel configured to forward to.',
      );
    }
    const channel = contactChannel.channel;
    const to = contactChannel.identifier;

    // ── Create the outbound message (writes timeline + emits message.outbound) ──
    const message = await this.enquiryService.addOutboundMessage(targetEnquiryId, {
      channel,
      to,
      subject: source.subject ?? undefined,
      body: source.content,
      userId,
    });

    // ── Copy attachments onto the new message BEFORE enqueue (enqueue reads them) ──
    if (source.attachments.length > 0) {
      await this.prisma.messageAttachment.createMany({
        data: source.attachments.map((a) => ({
          conversationMessageId: message.id,
          kind: a.kind,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          storageKey: a.storageKey,
          cdnUrl: a.cdnUrl,
          width: a.width,
          height: a.height,
          durationMs: a.durationMs,
        })),
      });
    }

    // ── Queue via enqueue() — idempotency guard in handleOutbound prevents double-queue ──
    const { jobId } = await this.outboundService.enqueue({
      messageId: message.id,
      enquiryId: targetEnquiryId,
      channel,
      to,
      content: source.content,
      subject: source.subject ?? undefined,
      fromUserId: userId,
    });

    if (jobId) {
      await this.prisma.conversationMessage.update({
        where: { id: message.id },
        data: { queueJobId: jobId },
      });
    }

    // ── Broadcast the forwarded message live into the target conversation ──
    this.eventEmitter.emit('message.outbound.broadcast', {
      contactId: enquiry.contactId,
      enquiryId: targetEnquiryId,
      messageId: message.id,
    });

    this.logger.log(
      `↪️ Forwarded message ${sourceMessageId} → enquiry ${targetEnquiryId} as ${message.id} (jobId: ${jobId})`,
    );

    return {
      messageId: message.id,
      jobId,
      deliveryStatus: 'PENDING',
      contactId: enquiry.contactId,
    };
  }
}
