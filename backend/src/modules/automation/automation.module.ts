import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AIModule } from 'src/ai/ai.module';
import { EnquiryModule } from '../enquiry/enquiry.module';
import { AiReplyScheduler } from './ai-reply.scheduler';
import { AiReplyProcessor } from './ai-reply.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-reply' }),
    AIModule,
    EnquiryModule,
  ],
  providers: [AiReplyScheduler, AiReplyProcessor],
})
export class AutomationModule {}
