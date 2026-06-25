import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { AIService } from './ai.service'
import { AIController } from './ai.controller'

@Module({
  imports: [HttpModule],
  controllers: [AIController],
  providers: [AIService],
  exports: [AIService]
})
export class AIModule {}