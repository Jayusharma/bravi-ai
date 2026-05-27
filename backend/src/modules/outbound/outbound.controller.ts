import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { Public } from 'src/common/decorator/public.decorator';
import { OutboundService } from './outbound.service';
import { EnquiryService } from '../enquiry/enquiry.service';
import { DeliveryTrackingService } from './delivery/delivery-tracking.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { AttachmentKind, DraftStatus } from '@prisma/client';
import { validateRequest as twilioValidateRequest } from 'twilio';
import multer = require('multer');

const MIME_TO_KIND: Record<string, AttachmentKind> = {
  'image/jpeg': AttachmentKind.IMAGE,
  'image/png': AttachmentKind.IMAGE,
  'image/gif': AttachmentKind.IMAGE,
  'image/webp': AttachmentKind.IMAGE,
  'image/svg+xml': AttachmentKind.IMAGE,
  'image/bmp': AttachmentKind.IMAGE,
  'video/mp4': AttachmentKind.VIDEO,
  'video/webm': AttachmentKind.VIDEO,
  'video/quicktime': AttachmentKind.VIDEO,
  'video/3gpp': AttachmentKind.VIDEO,
  'audio/webm': AttachmentKind.AUDIO,
  'audio/ogg': AttachmentKind.AUDIO,
  'audio/mpeg': AttachmentKind.AUDIO,
  'audio/aac': AttachmentKind.AUDIO,
  'audio/flac': AttachmentKind.AUDIO,
  'audio/opus': AttachmentKind.AUDIO,
  'audio/wav': AttachmentKind.AUDIO,
  'audio/mp4': AttachmentKind.VOICE_NOTE,
  'application/pdf': AttachmentKind.DOCUMENT,
  'application/msword': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': AttachmentKind.DOCUMENT,
  'application/vnd.ms-excel': AttachmentKind.DOCUMENT,
  'application/vnd.ms-powerpoint': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': AttachmentKind.DOCUMENT,
  'application/zip': AttachmentKind.DOCUMENT,
  'application/x-zip-compressed': AttachmentKind.DOCUMENT,
  'application/x-rar-compressed': AttachmentKind.DOCUMENT,
  'text/plain': AttachmentKind.DOCUMENT,
  'text/csv': AttachmentKind.DOCUMENT,
};

const ALLOWED_MIMES = new Set(Object.keys(MIME_TO_KIND));


@Controller('outbound')
@UseGuards(CaslGuard)
export class OutboundController {
  private readonly logger = new Logger(OutboundController.name);

  constructor(
    private readonly outboundService: OutboundService,
    private readonly enquiryService: EnquiryService,
    private readonly deliveryTracking: DeliveryTrackingService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── POST /outbound/enquiries/:enquiryId/drafts ──

  @Post('enquiries/:enquiryId/drafts')
  @CheckAbility({ action: 'create', subject: 'outbounddraft' })
  async createDraft(
    @Param('enquiryId') enquiryId: string,
    @Body() dto: CreateDraftDto,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    try {
      const draft = await this.prisma.outboundDraft.upsert({
        where: {
          enquiryId_channel_createdBy_status: {
            enquiryId,
            channel: dto.channel,
            createdBy: userId,
            status: DraftStatus.ACTIVE,
          },
        },
        create: {
          enquiryId,
          channel: dto.channel,
          subject: dto.subject,
          body: dto.body,
          createdBy: userId,
          expiresAt,
        },
        update: {
          subject: dto.subject,
          body: dto.body,
          expiresAt,
        },
      });
      return draft;
    } catch (err: any) {
      // P2002 = unique constraint race condition: another request already created the draft
      if (err?.code === 'P2002') {
        const existing = await this.prisma.outboundDraft.findFirst({
          where: { enquiryId, channel: dto.channel, createdBy: userId, status: DraftStatus.ACTIVE },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  // ── GET /outbound/enquiries/:enquiryId/draft ──

  @Get('enquiries/:enquiryId/draft')
  @CheckAbility({ action: 'read', subject: 'outbounddraft' })
  async getActiveDraft(
    @Param('enquiryId') enquiryId: string,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findFirst({
      where: { enquiryId, createdBy: userId, status: DraftStatus.ACTIVE },
      include: { attachments: true },
    });
    return draft ?? null;
  }

  // ── PATCH /outbound/drafts/:draftId ──

  @Patch('drafts/:draftId')
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  async updateDraft(
    @Param('draftId') draftId: string,
    @Body() dto: UpdateDraftDto,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot edit another user\'s draft');
    if (draft.status !== DraftStatus.ACTIVE) throw new BadRequestException('Draft is no longer active');

    const updated = await this.prisma.outboundDraft.update({
      where: { id: draftId },
      data: {
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    this.eventEmitter.emit('outbound.draft_saved', {
      enquiryId: updated.enquiryId,
      draftId: updated.id,
      updatedAt: updated.updatedAt,
    });

    return updated;
  }

  // ── DELETE /outbound/drafts/:draftId ──

  @Delete('drafts/:draftId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'delete', subject: 'outbounddraft' })
  async deleteDraft(@Param('draftId') draftId: string, @Req() req: Request) {
    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot delete another user\'s draft');

    await this.prisma.outboundDraft.update({
      where: { id: draftId },
      data: { status: DraftStatus.CLEARED },
    });
  }

  // ── POST /outbound/drafts/:draftId/send ──

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
        enquiry: {
          include: { contact: { include: { channels: true } } },
        },
      },
    });

    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot send another user\'s draft');
    if (draft.status !== DraftStatus.ACTIVE) throw new BadRequestException('Draft is not in ACTIVE state');

    // Allow sending with attachments even if body is empty (e.g. image-only message)
    const hasAttachments = await this.prisma.draftAttachment.count({ where: { draftId } }) > 0;
    if (!draft.body?.trim() && !hasAttachments) {
      throw new BadRequestException('Draft has no content and no attachments');
    }

    // Resolve recipient
    const channel = draft.channel;
    const contactChannel = draft.enquiry.contact.channels.find((c) => c.channel === channel);
    const to = dto.recipientOverride ?? contactChannel?.identifier;

    if (!to) {
      throw new BadRequestException(
        `Contact has no ${channel} channel. Add a recipientOverride or configure the contact's channel.`,
      );
    }

    // Create ConversationMessage + timeline via EnquiryService
    const message = await this.enquiryService.addOutboundMessage(draft.enquiryId, {
      channel,
      to,
      subject: draft.subject ?? undefined,
      body: draft.body ?? '',
      userId,
      draftId,
    });

    // Transfer DraftAttachments → MessageAttachments
    const draftAttachments = await this.prisma.draftAttachment.findMany({
      where: { draftId },
    });

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

    // Mark draft consumed
    await this.prisma.outboundDraft.update({
      where: { id: draftId },
      data: { status: DraftStatus.CLEARED },
    });

    // Re-fetch with attachments + sentByUser for the response
    const enrichedMessage = await this.prisma.conversationMessage.findUnique({
      where: { id: message.id },
      include: {
        attachments: {
          select: {
            id: true,
            kind: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            cdnUrl: true,
            width: true,
            height: true,
            durationMs: true,
          },
        },
        sentByUser: {
          select: { id: true, displayName: true, userName: true },
        },
      },
    });

    this.logger.log(`📤 Draft ${draftId} sent as message ${message.id} with ${draftAttachments.length} attachment(s)`);
    return enrichedMessage;
  }

  // ── GET /outbound/enquiries/:enquiryId/messages ──

  @Get('enquiries/:enquiryId/messages')
  @CheckAbility({ action: 'read', subject: 'conversationmessage' })
  async getOutboundMessages(
    @Param('enquiryId') enquiryId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const rawLimit = parseInt(limitStr ?? '50', 10);
    const rawOffset = parseInt(offsetStr ?? '0', 10);
    const limit = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100);
    const offset = isNaN(rawOffset) ? 0 : rawOffset;

    const [data, total] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { enquiryId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          sentByUser: { select: { id: true, displayName: true, userName: true } },
          attachments: true,
        },
      }),
      this.prisma.conversationMessage.count({
        where: { enquiryId, direction: 'OUTBOUND' },
      }),
    ]);

    return { data, total };
  }

  // ── POST /outbound/drafts/:draftId/attachments — Upload file ──

  @Post('drafts/:draftId/attachments')
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { cb(null, ALLOWED_MIMES.has(file.mimetype)); } }))
  async uploadDraftAttachment(
    @Param('draftId') draftId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file provided or unsupported file type');

    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot upload to another user\'s draft');
    if (draft.status !== DraftStatus.ACTIVE) throw new BadRequestException('Draft is not active');

    const kind = MIME_TO_KIND[file.mimetype] ?? AttachmentKind.DOCUMENT;
    const key = this.storage.generateKey(`drafts/${draftId}`, file.originalname);
    const cdnUrl = await this.storage.uploadBuffer(key, file.buffer, file.mimetype);

    const attachment = await this.prisma.draftAttachment.create({
      data: {
        draftId,
        kind,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageKey: key,
        cdnUrl,
      },
    });

    this.eventEmitter.emit('outbound.attachment_added', {
      draftId,
      enquiryId: draft.enquiryId,
      attachment: { id: attachment.id, cdnUrl, kind, fileName: file.originalname },
    });

    return { attachmentId: attachment.id, cdnUrl, kind, fileName: file.originalname, fileSize: file.size };
  }

  // ── DELETE /outbound/drafts/:draftId/attachments/:attachmentId ──

  @Delete('drafts/:draftId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  async deleteDraftAttachment(
    @Param('draftId') draftId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const draft = await this.prisma.outboundDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new BadRequestException('Cannot modify another user\'s draft');

    const attachment = await this.prisma.draftAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.draftId !== draftId) throw new NotFoundException('Attachment not found');

    await this.prisma.draftAttachment.delete({ where: { id: attachmentId } });
    this.storage.deleteFile(attachment.storageKey).catch((err) =>
      this.logger.error(`Failed to delete R2 object ${attachment.storageKey}: ${err.message}`),
    );
  }

  // ── POST /outbound/messages/:messageId/retry ──

  @Post('messages/:messageId/retry')
  @CheckAbility({ action: 'update', subject: 'conversationmessage' })
  async retryMessage(@Param('messageId') messageId: string) {
    await this.outboundService.retryMessage(messageId);

    // Emit for socket broadcast
    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
    });
    if (msg) {
      this.eventEmitter.emit('outbound.retry_queued', {
        messageId,
        enquiryId: msg.enquiryId,
      });
    }

    return { queued: true };
  }

  // ── POST /outbound/messages/:messageId/reactions — Add reaction ──

  @Post('messages/:messageId/reactions')
  @CheckAbility({ action: 'create', subject: 'conversationmessage' })
  async addReaction(
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
    @Req() req: Request,
  ) {
    if (!body.emoji) throw new BadRequestException('emoji is required');
    const userId = req.user!.userId;

    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    await this.prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji: body.emoji } },
      create: { messageId, userId, emoji: body.emoji },
      update: {},
    });

    const reactions = await this.buildReactionSummary(messageId);
    this.eventEmitter.emit('message.reaction_updated', { messageId, enquiryId: msg.enquiryId, reactions });
    return { reactions };
  }

  // ── DELETE /outbound/messages/:messageId/reactions/:emoji — Remove reaction ──

  @Delete('messages/:messageId/reactions/:emoji')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'delete', subject: 'conversationmessage' })
  async removeReaction(
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
    @Req() req: Request,
  ) {
    const userId = req.user!.userId;
    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    await this.prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });

    const reactions = await this.buildReactionSummary(messageId);
    this.eventEmitter.emit('message.reaction_updated', { messageId, enquiryId: msg.enquiryId, reactions });
  }

  // ── PATCH /outbound/messages/:messageId/delete — Soft delete ──

  @Patch('messages/:messageId/delete')
  @CheckAbility({ action: 'delete', subject: 'conversationmessage' })
  async softDeleteMessage(@Param('messageId') messageId: string, @Req() req: Request) {
    const userId = req.user!.userId;
    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.sentByUserId !== userId && req.user!.role !== 'ADMIN') {
      throw new ForbiddenException('Cannot delete another user\'s message');
    }
    await this.prisma.conversationMessage.update({ where: { id: messageId }, data: { isDeleted: true } });
    this.eventEmitter.emit('message.deleted', { messageId, enquiryId: msg.enquiryId });
    return { deleted: true };
  }

  // ── PATCH /outbound/messages/:messageId/edit — Edit message content ──

  @Patch('messages/:messageId/edit')
  @CheckAbility({ action: 'update', subject: 'conversationmessage' })
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() body: { content: string },
    @Req() req: Request,
  ) {
    if (!body.content?.trim()) throw new BadRequestException('content is required');
    const userId = req.user!.userId;
    const msg = await this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.sentByUserId !== userId) throw new ForbiddenException('Cannot edit another user\'s message');
    if (msg.direction !== 'OUTBOUND') throw new BadRequestException('Can only edit outbound messages');

    const ageMins = (Date.now() - new Date(msg.createdAt).getTime()) / 60_000;
    if (ageMins > 15) throw new BadRequestException('Edit window expired (15 minutes)');

    const updated = await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data: { content: body.content.trim(), editedAt: new Date() },
    });

    this.eventEmitter.emit('message.edited', {
      messageId,
      enquiryId: msg.enquiryId,
      content: updated.content,
      editedAt: updated.editedAt,
    });

    return updated;
  }

  private async buildReactionSummary(messageId: string) {
    const reactions = await this.prisma.messageReaction.groupBy({
      by: ['emoji'],
      where: { messageId },
      _count: { emoji: true },
    });
    return reactions.map((r) => ({ emoji: r.emoji, count: r._count.emoji }));
  }

  // ── POST /outbound/webhooks/whatsapp/delivery — Twilio callback ──

  @Post('webhooks/whatsapp/delivery')
  @Public()
  @HttpCode(HttpStatus.OK)
  async twilioDelivery(@Body() body: Record<string, string>, @Req() req: Request) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      const url = `${process.env.BACKEND_PUBLIC_URL || ''}/api/v1/outbound/webhooks/whatsapp/delivery`;
      const isValid = twilioValidateRequest(authToken, signature ?? '', url, body);
      if (!isValid) {
        this.logger.warn('🚫 Twilio webhook signature validation failed');
        throw new ForbiddenException('Invalid Twilio signature');
      }
    }
    await this.deliveryTracking.handleTwilioDelivery(body);
    return { ok: true };
  }

  // ── POST /outbound/webhooks/email/delivery — SendGrid callback ──

  @Post('webhooks/email/delivery')
  @Public()
  @HttpCode(HttpStatus.OK)
  async sendgridDelivery(@Body() events: Array<Record<string, any>>) {
    await this.deliveryTracking.handleSendGridDelivery(events);
    return { ok: true };
  }
}
