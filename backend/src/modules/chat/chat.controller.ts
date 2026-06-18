import { Controller, Get, Post, Body, UseGuards, Req, Param, Query } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';

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
  // GET /chat/room/:id/messages — paginated history (oldest → newest)
  // ═══════════════════════════════════════════════════════════════════
  @Get('room/:id/messages')
  @CheckAbility({ action: 'read', subject: 'chat' })
  getMessages(@Param('id') id: string, @Query() query: GetMessagesDto) {
    return this.chatService.getMessages(id, {
      cursor: query.cursor,
      limit: query.limit,
    });
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
    });
  }
}
