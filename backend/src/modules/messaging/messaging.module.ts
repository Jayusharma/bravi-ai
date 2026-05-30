import { Module } from '@nestjs/common';
import { ConversationService } from './messaging.service';
import { ConversationController } from './messaging.controller';

@Module({
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class MessagingModule {}
