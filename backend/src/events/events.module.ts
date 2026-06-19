// events.module.ts — Hosts AppEventHandler; the single internal event listener registry.

import { Module } from '@nestjs/common';
import { AppEventHandler } from './app.event-handler';
import { WebsocketModule } from '../websocket/websocket.module';
import { MessagingModule } from '../modules/messaging/messaging.module';
import { ChatModule } from '../modules/chat/chat.module';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [WebsocketModule, MessagingModule, ChatModule, PrismaModule],
  providers: [AppEventHandler],
})
export class EventsModule {}
