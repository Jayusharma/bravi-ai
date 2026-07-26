import { Controller, Get, Param, Query, Req, Patch } from '@nestjs/common';
import { ConversationService } from './messaging.service';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import type { Request } from 'express';

@Controller('conversations')
export class ConversationController {
  constructor(private conversationService: ConversationService) {}
  /**
   * GET /conversations
   * List all conversations for the chat sidebar.
   *
   * Query params:
   *   ?search=Rahul     — filter by name or phone
   *   ?page=1&limit=30  — pagination
   */
  @Get()
  @CheckAbility({ action: 'read', subject: 'contact' })
  listConversations(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
  ) {
    return this.conversationService.listConversations(
      {
        search,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
        channel,
      },
      req.user!.userId,
    );
  }


  @Get(':contactId/thread')
  @CheckAbility({action: 'read' , subject: 'messages'})
  getThread(@Param('contactId') contactId: string) {
    return this.conversationService.getThread(contactId);
  }

  @Patch('messages/:messageId/star')
  @CheckAbility({ action: 'update', subject: 'message' })
  toggleMessageStar(@Param('messageId') messageId: string) {
    return this.conversationService.toggleMessageStar(messageId);
  }

  @Get(':contactId/starred')
  @CheckAbility({ action: 'read', subject: 'message' })
  getStarredMessages(@Param('contactId') contactId: string) {
    return this.conversationService.getStarredMessages(contactId);
  }
}