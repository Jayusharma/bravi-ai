// outbound.controller.ts — Retry + delivery webhooks.
// Draft endpoints → DraftController. Message endpoints → MessageController.
// Send endpoint (sendDraft shim) stays here until Step 5/11 replaces it with socket outbound:send.

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { Public } from 'src/common/decorator/public.decorator';
import { OutboundService } from './outbound.service';
import { EnquiryService } from '../enquiry/enquiry.service';
import { DeliveryTrackingService } from './delivery/delivery-tracking.service';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SendMessageDto } from './dto/send-message.dto';
import { DraftStatus } from '@prisma/client';

@Controller('outbound')
export class OutboundController {
  private readonly logger = new Logger(OutboundController.name);

  constructor(
    private readonly outboundService: OutboundService,
    private readonly enquiryService: EnquiryService,
    private readonly deliveryTracking: DeliveryTrackingService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── POST /outbound/drafts/:draftId/send ──
  // Shim: delegates to existing EnquiryService send path.
  // Removed in Step 11 when frontend switches to socket outbound:send.

  @Post('drafts/:draftId/send')
  @CheckAbility({ action: 'create', subject: 'conversationmessage' })
  async sendDraft(
    @Param('draftId') draftId: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findUnique({
      where: { id: draftId },
      include: {
        enquiry: { include: { contact: { include: { channels: true } } } },
      },
    });

    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot send another user\'s draft');
    if (draft.status !== DraftStatus.ACTIVE) throw new BadRequestException('Draft is not in ACTIVE state');

    const hasAttachments = await this.prisma.draftAttachment.count({ where: { draftId } }) > 0;
    if (!draft.body?.trim() && !hasAttachments) {
      throw new BadRequestException('Draft has no content and no attachments');
    }

    const channel = draft.channel;
    const contactChannel = draft.enquiry.contact.channels.find((c) => c.channel === channel);
    const to = dto.recipientOverride ?? contactChannel?.identifier;

    if (!to) {
      throw new BadRequestException(
        `Contact has no ${channel} channel. Add a recipientOverride or configure the contact's channel.`,
      );
    }

    const message = await this.enquiryService.addOutboundMessage(draft.enquiryId, {
      channel,
      to,
      subject: draft.subject ?? undefined,
      body: draft.body ?? '',
      userId,
      draftId,
    });

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

    const enrichedMessage = await this.prisma.conversationMessage.findUnique({
      where: { id: message.id },
      include: {
        attachments: {
          select: { id: true, kind: true, fileName: true, mimeType: true, fileSize: true, cdnUrl: true, width: true, height: true, durationMs: true },
        },
        sentByUser: { select: { id: true, displayName: true, userName: true } },
      },
    });

    this.logger.log(`📤 Draft ${draftId} sent as message ${message.id}`);
    return enrichedMessage;
  }

  // ── POST /outbound/messages/:messageId/retry ──

  /** Re-queues a permanently failed message for delivery */
  @Post('messages/:messageId/retry')
  @CheckAbility({ action: 'update', subject: 'conversationmessage' })
  async retryMessage(@Param('messageId') messageId: string) {
    await this.outboundService.retryMessage(messageId);
    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (msg) {
      this.eventEmitter.emit('outbound.retry_queued', { messageId, enquiryId: msg.enquiryId });
    }
    return { queued: true };
  }

  // ── POST /outbound/webhooks/email/delivery — SendGrid event callback ──

  @Post('webhooks/email/delivery')
  @Public()
  @HttpCode(HttpStatus.OK)
  async sendgridDelivery(@Body() events: Array<Record<string, any>>) {
    await this.deliveryTracking.handleSendGridDelivery(events);
    return { ok: true };
  }
}
