// message.controller.ts — Outbound message history (cursor-paginated), reactions, edit, soft delete.

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsUUID } from 'class-validator';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { decodeCursor, buildCursorWhere, paginateResult } from 'src/common/utils/cursor';
import { OutboundSendService } from './outbound-send.service';

class ForwardMessageDto {
  @IsUUID()
  targetEnquiryId: string;
}

@Controller('outbound')
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly outboundSendService: OutboundSendService,
  ) {}

  // ── GET /outbound/enquiries/:enquiryId/messages ──

  /** Cursor-paginated message history. Default limit 50, max 100. Newest first. */
  @Get('enquiries/:enquiryId/messages')
  @CheckAbility({ action: 'read', subject: 'conversationmessage' })
  async getMessages(
    @Param('enquiryId') enquiryId: string,
    @Query('cursor') cursorStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const cursor = decodeCursor(cursorStr);
    const limit = Math.min(Math.max(parseInt(limitStr ?? '50', 10) || 50, 1), 100);

    const rows = await this.prisma.conversationMessage.findMany({
      where: {
        enquiryId,
        ...(cursor ? buildCursorWhere(cursor) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        sentByUser: { select: { id: true, displayName: true, userName: true } },
        attachments: true,
      },
    });

    return paginateResult(rows, limit);
  }

  // ── POST /outbound/messages/:messageId/reactions ──

  /** Upserts a reaction emoji on a message; broadcasts updated summary to contact room */
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

  // ── DELETE /outbound/messages/:messageId/reactions/:emoji ──

  /** Removes a specific emoji reaction by the requesting user */
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

  // ── POST /outbound/messages/:messageId/forward ──

  /** Forwards a message into another conversation (re-sends content + attachments) */
  @Post('messages/:messageId/forward')
  @CheckAbility({ action: 'create', subject: 'conversationmessage' })
  async forwardMessage(
    @Param('messageId') messageId: string,
    @Body() body: ForwardMessageDto,
    @Req() req: Request,
  ) {
    return this.outboundSendService.forward({
      sourceMessageId: messageId,
      targetEnquiryId: body.targetEnquiryId,
      userId: req.user!.userId,
    });
  }

  // ── PATCH /outbound/messages/:messageId/delete ──

  /** Soft-deletes a message; only sender or ADMIN can delete */
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

  // ── PATCH /outbound/messages/:messageId/edit ──

  /** Edits message content within 15-minute window; only the sender can edit */
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

  /** Groups reactions by emoji and returns a count summary */
  private async buildReactionSummary(messageId: string) {
    const rows = await this.prisma.messageReaction.groupBy({
      by: ['emoji'],
      where: { messageId },
      _count: { emoji: true },
    });
    return rows.map((r) => ({ emoji: r.emoji, count: r._count.emoji }));
  }
}
