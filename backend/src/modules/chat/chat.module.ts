import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    StorageModule, // Provides StorageService — chat attachment uploads go to R2 under chat/<convId>/
  ],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
