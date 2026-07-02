import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { MessageChannel } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { AIService } from 'src/ai/ai.service';
import { EnquiryService } from '../enquiry/enquiry.service';

// ═══════════════════════════════════════════════════════════════════
// AI Auto-Reply Processor
//
// Fires ~90s after a new enquiry is created. The engine re-validates
// state at fire time (it watches; the AI doesn't): if a human already
// replied, or the enquiry closed, it does nothing. Otherwise it asks
// the brain for a reply and sends it on the same channel the lead used.
// ═══════════════════════════════════════════════════════════════════

@Processor('ai-reply')
export class AiReplyProcessor extends WorkerHost {
  private readonly logger = new Logger(AiReplyProcessor.name);
  private readonly confidenceThreshold: number;

  constructor(
    private prisma: PrismaService,
    private aiService: AIService,
    private enquiryService: EnquiryService,
    private config: ConfigService,
  ) {
    super();
    this.confidenceThreshold = this.config.get<number>(
      'AI_REPLY_CONFIDENCE_THRESHOLD',
      0.6,
    );
  }

  async process(job: Job<{ enquiryId: string }>): Promise<void> {
    const { enquiryId } = job.data;

    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!enquiry) {
      this.logger.warn(`AI reply skipped — enquiry ${enquiryId} not found`);
      return;
    }

    if (enquiry.status === 'CONVERTED' || enquiry.status === 'CLOSED_LOST') {
      this.logger.debug(`AI reply skipped — enquiry ${enquiryId} is ${enquiry.status}`);
      return;
    }

    // Guard: if anyone (human or AI) has already replied, do nothing.
    // Covers "agent replied within 90s", "once per enquiry", and idempotency.
    const hasOutbound = enquiry.messages.some((m) => m.direction === 'OUTBOUND');
    if (hasOutbound) {
      this.logger.log(`AI reply skipped — enquiry ${enquiryId} already has a reply`);
      return;
    }

    const firstInbound = enquiry.messages.find((m) => m.direction === 'INBOUND');
    if (!firstInbound) {
      this.logger.warn(`AI reply skipped — no inbound message on enquiry ${enquiryId}`);
      return;
    }

    const channel = firstInbound.channel;
    const to = firstInbound.from; // the customer's address

    const ai = await this.aiService.getReply(enquiryId, channel);

    if (
      !ai ||
      ai.action === 'escalate' ||
      !ai.reply ||
      ai.confidence < this.confidenceThreshold
    ) {
      this.logger.log(
        `AI reply held for enquiry ${enquiryId} — left for a human (action=${ai?.action ?? 'null'}, confidence=${ai?.confidence ?? 'n/a'})`,
      );
      return;
    }

    await this.enquiryService.addAiReply(enquiryId, {
      channel,
      to,
      body: ai.reply,
      subject: channel === MessageChannel.EMAIL ? (ai.subject ?? undefined) : undefined,
    });

    this.logger.log(`🤖 AI auto-reply sent for enquiry ${enquiryId} on ${channel}`);
  }
}
