// websocket.module.ts — Hosts AppGateway; the single WebSocket gateway for all socket events.

import { Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { PrismaModule } from '../database/prisma.module';
import { OutboundModule } from '../modules/outbound/outbound.module';
import { ChatModule } from '../modules/chat/chat.module';
import { MessagingModule } from '../modules/messaging/messaging.module';

@Module({
  imports: [PrismaModule, OutboundModule, ChatModule, MessagingModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketModule {}
