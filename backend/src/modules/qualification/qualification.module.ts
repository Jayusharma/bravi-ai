import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QualificationService } from './qualification.service';
import { QualificationProcessor } from './processors/qualification.processor';
import { AIClassifierStrategy } from './strategies/ai.strategy';

@Module({
    imports: [
        // Register the qualification queue (jobs added by IngestionService)
        BullModule.registerQueue({
            name: 'qualification',
        }),
    ],
    providers: [
        QualificationService,
        QualificationProcessor,
        AIClassifierStrategy,
    ],
    exports: [QualificationService],
})
export class QualificationModule { }
