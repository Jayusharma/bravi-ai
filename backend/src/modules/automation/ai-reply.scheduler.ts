import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// ═══════════════════════════════════════════════════════════════════
// AI Auto-Reply Scheduler
//
// When a NEW enquiry is created, arm a delayed job. If no human replies
// within the window, the processor sends one AI reply to keep the lead
// warm. Deterministic jobId = one timer per enquiry (idempotent).
// ═══════════════════════════════════════════════════════════════════

@Injectable()
export class AiReplyScheduler {
  private readonly logger = new Logger(AiReplyScheduler.name);
  private readonly DELAY_MS = 90_000; // 90 seconds

  constructor(@InjectQueue('ai-reply') private readonly queue: Queue) {}

  @OnEvent('enquiry.created')
  async onEnquiryCreated(payload: { enquiryId: string; contactId?: string }): Promise<void> {
    const { enquiryId } = payload;
    if (!enquiryId) return;

    await this.queue.add(
      'ai-reply',
      { enquiryId },
      {
        delay: this.DELAY_MS,
        jobId: `ai-reply-${enquiryId}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.logger.log(
      `⏲️  Armed AI auto-reply for enquiry ${enquiryId} (fires in ${this.DELAY_MS / 1000}s if no human replies)`,
    );
  }
}
