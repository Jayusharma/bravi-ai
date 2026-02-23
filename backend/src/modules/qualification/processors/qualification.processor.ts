import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QualificationService } from '../qualification.service';

// ═══════════════════════════════════════════════════════════════════
// BullMQ Worker — picks up jobs from the 'qualification' queue
//
// The IngestionService adds jobs to this queue. This processor
// runs asynchronously and calls QualificationService.qualify().
//
// WHY BullMQ:
//   - AI calls take 1-3 seconds. We don't want the webhook to wait.
//   - Automatic retries on failure (3 attempts with exponential backoff)
//   - Job deduplication via jobId
//   - Concurrency control
// ═══════════════════════════════════════════════════════════════════

@Processor('qualification')
export class QualificationProcessor extends WorkerHost {
    private readonly logger = new Logger(QualificationProcessor.name);

    constructor(private qualificationService: QualificationService) {
        super();
    }

    async process(job: Job<{ inboundMessageId: string }>): Promise<void> {
        const { inboundMessageId } = job.data;
        console.log("the worker has picked the job ")
        this.logger.log(`⚙️ Processing qualification job for message: ${inboundMessageId}`);

        try {
            await this.qualificationService.qualify(inboundMessageId);
            this.logger.log(`✅ Qualification complete for message: ${inboundMessageId}`);
        } catch (error) {
            this.logger.error(
                `❌ Qualification job failed for ${inboundMessageId}: ${error.message}`,
            );
            throw error; // Re-throw so BullMQ retries
        }
    }
}
