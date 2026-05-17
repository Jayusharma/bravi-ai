import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QualificationService } from '../qualification.service';

@Processor('qualification')
export class QualificationProcessor extends WorkerHost {
  private readonly logger = new Logger(QualificationProcessor.name);

  constructor(private qualificationService: QualificationService) {
    super();
  }

  async process(job: Job<{ inboundMessageId: string }>): Promise<void> {
    const { inboundMessageId } = job.data;
    this.logger.log(` Processing qualification job for message: ${inboundMessageId} `);

    try {
      await this.qualificationService.qualify(inboundMessageId);
      this.logger.log(`Qualification complete for message: ${inboundMessageId}`);
    } catch (error) {
      this.logger.error(
        `Qualification job failed for ${inboundMessageId}: ${error.message}`,
      );
      throw error;
    }
  }
}
