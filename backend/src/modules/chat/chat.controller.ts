import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Req, Param, Query } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { MessagesAroundDto } from './dto/messages-around.dto';

@Controller('chat')
@UseGuards(CaslGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
  getMembers(@Param('id') id: string) {
    return this.chatService.getMembers(id);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /chat/room/:id/pinned — active pinned messages
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/pinned')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getPinnedMessages(@Param('id') id: string, @Req() req: Request) {
    return this.chatService.getPinnedMessages(id, req.user!.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /chat/room/:id/messages — send a text message
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
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/room/:roomId/messages/:messageId/pin — toggle message pin
  // ═══════════════════════════════════════════════════════════════════
  @Patch('room/:roomId/messages/:messageId/pin')
  @CheckAbility({ action: 'update', subject: 'chat' })
  pinMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.togglePinMessage(messageId, roomId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /chat/room/:roomId/messages/:messageId/star — toggle message star
  // ═══════════════════════════════════════════════════════════════════
  @Patch('room/:roomId/messages/:messageId/star')
  @CheckAbility({ action: 'update', subject: 'chat' })
  starMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.toggleStarMessage(messageId, roomId);
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
