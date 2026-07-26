import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import multer = require('multer');
import { ChatService } from './chat.service';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
// Shared upload rules — same allowlist the enquiry-messaging uploads use
import { ALLOWED_MIMES } from '../outbound/draft.service';
import { GetMessagesDto } from './dto/get-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { MessagesAroundDto } from './dto/messages-around.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { AddMembersDto, OpenDmDto } from './dto/members.dto';
import { ReactDto } from './dto/react.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Org-admins (manage:chatchannel via manage:all) bypass channel-level ADMIN checks. */
  private canManageChannels(req: Request): boolean {
    return req.ability?.can('manage', 'chatchannel') ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/conversations — the sidebar: my channels + DMs with unreads
  // ═══════════════════════════════════════════════════════════════════
  @Get('conversations')
  @CheckAbility({ action: 'read', subject: 'chat' })
  listConversations(@Query('includeArchived') includeArchived: string, @Req() req: Request) {
    return this.chatService.listConversations(req.user!.userId, includeArchived === 'true');
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/channels — create a channel (admin/manager only)
  // ═══════════════════════════════════════════════════════════════════
  @Post('channels')
  @CheckAbility({ action: 'create', subject: 'chatchannel' })
  createChannel(@Body() dto: CreateChannelDto, @Req() req: Request) {
    return this.chatService.createChannel(req.user!.userId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/channels/:id — rename / edit description / archive-restore
  // ═══════════════════════════════════════════════════════════════════
  @Patch('channels/:id')
  @CheckAbility({ action: 'update', subject: 'chatchannel' })
  updateChannel(@Param('id') id: string, @Body() dto: UpdateChannelDto, @Req() req: Request) {
    return this.chatService.updateChannel(id, req.user!.userId, dto, this.canManageChannels(req));
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/channels/:id/members — "Add People" (channel admin)
  // CASL gate is just "can use chat" — the REAL rule (channel ADMIN) is in the service.
  // ═══════════════════════════════════════════════════════════════════
  @Post('channels/:id/members')
  @CheckAbility({ action: 'read', subject: 'chat' })
  addMembers(@Param('id') id: string, @Body() dto: AddMembersDto, @Req() req: Request) {
    return this.chatService.addMembers(id, req.user!.userId, dto.userIds, this.canManageChannels(req));
  }

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /chat/channels/:id/members/:userId — kick (channel admin) or self-leave
  // ═══════════════════════════════════════════════════════════════════
  @Delete('channels/:id/members/:userId')
  @CheckAbility({ action: 'read', subject: 'chat' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    return this.chatService.removeMember(id, req.user!.userId, userId, this.canManageChannels(req));
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/dm — open (or find) the DM with another user — idempotent
  // ═══════════════════════════════════════════════════════════════════
  @Post('dm')
  @CheckAbility({ action: 'create', subject: 'chat' })
  openDm(@Body() dto: OpenDmDto, @Req() req: Request) {
    return this.chatService.openDm(req.user!.userId, dto.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/files — Files tab (paginated attachments)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/files')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getChannelFiles(@Param('id') id: string, @Query() query: GetMessagesDto, @Req() req: Request) {
    return this.chatService.getChannelFiles(id, req.user!.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/meta — bootstrap metadata to open ANY channel/DM
  // (read boundary, unread count, first-unread anchor, receipts)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/meta')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getRoomMeta(@Param('id') id: string, @Req() req: Request) {
    return this.chatService.getRoomMeta(id, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room — resolve (and lazily create + join) the common room
  // ═══════════════════════════════════════════════════════════════════
  @Get('room')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getRoom(@Req() req: Request) {
    return this.chatService.getRoomForUser(req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/unread — read-only unread count for the sidebar badge
  // ═══════════════════════════════════════════════════════════════════
  @Get('unread')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getUnread(@Req() req: Request) {
    return this.chatService.getUnreadForUser(req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/messages — paginated history (oldest → newest)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/messages')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getMessages(@Param('id') id: string, @Query() query: GetMessagesDto, @Req() req: Request) {
    return this.chatService.getMessages(id, {
      cursor: query.cursor,
      limit: query.limit,
    }, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/messages/search — keyword search within the room
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/messages/search')
  @CheckAbility({ action: 'read', subject: 'chat' })
  searchMessages(@Param('id') id: string, @Query() query: SearchMessagesDto, @Req() req: Request) {
    return this.chatService.searchMessages(id, query.q, query.limit, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/messages/newer — page of messages after a cursor
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/messages/newer')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getNewerMessages(@Param('id') id: string, @Query() query: GetMessagesDto, @Req() req: Request) {
    return this.chatService.getNewerMessages(id, query.cursor!, query.limit, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/messages/around — window of messages around one message
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/messages/around')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getMessagesAround(@Param('id') id: string, @Query() query: MessagesAroundDto, @Req() req: Request) {
    return this.chatService.getMessagesAround(
      id,
      query.messageId,
      query.before,
      query.after,
      req.user!.userId,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/members — active members with name, role, presence
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/members')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getMembers(@Param('id') id: string, @Req() req: Request) {
    return this.chatService.getMembers(id, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/pinned — active pinned messages (thread banner)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/pinned')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getPinnedMessages(@Param('id') id: string, @Req() req: Request) {
    return this.chatService.getPinnedMessages(id, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/starred — starred messages (the room's Starred tab)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/starred')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getStarredMessages(@Param('id') id: string, @Req() req: Request) {
    return this.chatService.getStarredMessages(id, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/room/:id/messages — send a message (text and/or attachments)
  // ═══════════════════════════════════════════════════════════════════
  @Post('room/:id/messages')
  @CheckAbility({ action: 'create', subject: 'chat' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.chatService.sendMessage({
      conversationId: id,
      senderId: req.user!.userId,
      content: dto.content,
      parentMessageId: dto.parentMessageId,
      attachments: dto.attachments,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/room/:id/attachments — stage a file upload (returns a descriptor;
  // the client passes descriptors back via POST .../messages to attach them)
  // ═══════════════════════════════════════════════════════════════════
  @Post('room/:id/attachments')
  @CheckAbility({ action: 'create', subject: 'chat' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // same cap as enquiry-messaging uploads
      fileFilter: (_req, file, cb) => { cb(null, ALLOWED_MIMES.has(file.mimetype)); },
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file provided or unsupported file type');
    return this.chatService.uploadAttachment(id, req.user!.userId, file);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/room/:roomId/messages/:messageId/reactions — toggle an emoji reaction
  // ═══════════════════════════════════════════════════════════════════
  @Post('room/:roomId/messages/:messageId/reactions')
  @CheckAbility({ action: 'create', subject: 'chat' })
  toggleReaction(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReactDto,
    @Req() req: Request,
  ) {
    return this.chatService.toggleReaction(roomId, messageId, req.user!.userId, dto.emoji);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/room/:roomId/messages/:messageId/pin — toggle message pin
  // ═══════════════════════════════════════════════════════════════════
  @Patch('room/:roomId/messages/:messageId/pin')
  @CheckAbility({ action: 'update', subject: 'chat' })
  pinMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Req() req: Request,
  ) {
    return this.chatService.togglePinMessage(messageId, roomId, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/room/:roomId/messages/:messageId/star — toggle message star
  // ═══════════════════════════════════════════════════════════════════
  @Patch('room/:roomId/messages/:messageId/star')
  @CheckAbility({ action: 'update', subject: 'chat' })
  starMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Req() req: Request,
  ) {
    return this.chatService.toggleStarMessage(messageId, roomId, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/room/:roomId/messages/:messageId — edit message content
  // ═══════════════════════════════════════════════════════════════════
  @Patch('room/:roomId/messages/:messageId')
  @CheckAbility({ action: 'update', subject: 'chat' })
  editMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Body('content') content: string,
    @Req() req: Request,
  ) {
    return this.chatService.editMessage(messageId, content, req.user!.userId, roomId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /chat/room/:roomId/messages/:messageId — delete message (for me/everyone)
  // ═══════════════════════════════════════════════════════════════════
  @Delete('room/:roomId/messages/:messageId')
  @CheckAbility({ action: 'delete', subject: 'chat' })
  deleteMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Query('deleteForEveryone') deleteForEveryone: string,
    @Req() req: Request,
  ) {
    const forEveryone = deleteForEveryone === 'true';
    if (forEveryone) {
      return this.chatService.deleteMessageForEveryone(messageId, req.user!.userId, roomId);
    } else {
      return this.chatService.deleteMessageForMe(messageId, req.user!.userId);
    }
  }
}
