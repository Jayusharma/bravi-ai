import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';

// ChannelsModule owns ChannelConnection CRUD + the on/off toggle.
// Exports ChannelsService so OutboundModule and WebhooksModule can check the toggle
// before sending / accepting a message — neither of them imports the other.
@Module({
  providers: [ChannelsService],
  controllers: [ChannelsController],
  exports: [ChannelsService],
})
export class ChannelsModule {}
