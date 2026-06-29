import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QualificationService } from './qualification.service';
import { QualificationProcessor } from './processors/qualification.processor';
import { AIModule } from 'src/ai/ai.module';

@Module({
    imports: [
        // The AI gateway — provides QualificationAIClient (HTTP → Python brain)
        AIModule,
        // Register the qualification queue (jobs added by IngestionService)
        BullModule.registerQueue({
            name: 'qualification',
        }),
    ],
    providers: [
        QualificationService,
        QualificationProcessor,
    ],
    exports: [QualificationService],
})
export class QualificationModule { }
