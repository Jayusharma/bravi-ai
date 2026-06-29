import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { AIService } from './ai.service'
import { AIController } from './ai.controller'
import { QualificationAIClient } from './qualification.client'

@Module({
  imports: [HttpModule],
  controllers: [AIController],
  providers: [AIService, QualificationAIClient],
  exports: [AIService, QualificationAIClient]
})
export class AIModule {}
