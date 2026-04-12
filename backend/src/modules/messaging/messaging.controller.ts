import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ConversationService } from './messaging.service';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
@Controller('conversations')
@UseGuards(CaslGuard)
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
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationService.listConversations({
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }


  @Get(':contactId/thread')
  @CheckAbility({action: 'read' , subject: 'messages'})
  getThread(@Param('contactId') contactId: string) {
    return this.conversationService.getThread(contactId);
  }
  

}