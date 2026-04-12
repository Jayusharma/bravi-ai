import { Module } from '@nestjs/common';
import { MessagingGateway } from './messaging.gateway';
import { ConversationService } from './messaging.service';
import { ConversationController } from './messaging.controller';

@Module({
  controllers: [ConversationController],
  providers: [MessagingGateway, ConversationService],
  exports: [ConversationService , MessagingGateway],
})
export class MessagingModule  {}
