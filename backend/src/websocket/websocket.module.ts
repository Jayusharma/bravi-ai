// websocket.module.ts — Hosts AppGateway; the single WebSocket gateway for all socket events.

import { Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { PrismaModule } from '../database/prisma.module';
import { OutboundModule } from '../modules/outbound/outbound.module';

@Module({
  imports: [PrismaModule, OutboundModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketModule {}
