import { Module } from '@nestjs/common';
import { PlaygroundGateway } from './messaging.gateway';

@Module({
  providers: [PlaygroundGateway],
})
export class PlaygroundModule {}
