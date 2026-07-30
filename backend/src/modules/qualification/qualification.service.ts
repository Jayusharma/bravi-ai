import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { QualificationAIClient } from 'src/ai/qualification.client';
import {
  EnquiryIntent,
  QualificationLayer,
  QualificationStatus,
} from '@prisma/client';

@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private prisma: PrismaService,
    private aiClassifier: QualificationAIClient,
    private eventEmitter: EventEmitter2,
    private config: ConfigService,
  ) {
    this.confidenceThreshold = this.config.get<number>(
      'QUALIFICATION_AI_CONFIDENCE_THRESHOLD',
      50,
    );
  }

  async qualify(inboundMessageId: string): Promise<void> {
    const startTime = Date.now();

    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
      include: { qualificationResult: true },
    });

    if (!message) {
      throw new NotFoundException(`InboundMessage ${inboundMessageId} not found`);
    }

    if (
      message.qualificationResult &&
      message.status !== QualificationStatus.PENDING &&
      message.status !== QualificationStatus.PROCESSING
    ) {
      this.logger.debug(
        `Skipping qualification for ${inboundMessageId} already finalized as ${message.status}`,
      );
      return;
    }

    await this.prisma.inboundMessage.update({
      where: { id: inboundMessageId },
      data: { status: QualificationStatus.PROCESSING },
    });

    try {
      const aiResult = await this.aiClassifier.classify({
        body: message.body,
        from: message.from,
        channel: message.channel,
      });

      let finalStatus: QualificationStatus;
      if (aiResult.confidence === 0) {
        // AI failed completely → manual review (never lose a message)
        finalStatus = QualificationStatus.NEEDS_REVIEW;
      } else if (aiResult.isLead && aiResult.confidence >= this.confidenceThreshold) {
        // AI is confident it's a real lead
        finalStatus = QualificationStatus.REAL_ENQUIRY;
      } else if (!aiResult.isLead && aiResult.confidence >= 70) {
        // AI is confident it's NOT a lead (spam/noise) — mark as spam
        finalStatus = QualificationStatus.SPAM;
      } else {
        // AI is uncertain — route to human review, never lose the message
        finalStatus = QualificationStatus.NEEDS_REVIEW;
      }

      if (aiResult.extractedData?.contactName && message.contactId) {
        await this.prisma.contact.update({
          where: { id: message.contactId },
          data: {
            displayName: aiResult.extractedData.contactName,
          },
        }).catch((err: Error) => {
          this.logger.warn(`Failed to update contact ${message.contactId} display name: ${err.message}`);
        });
      }

      const processingTimeMs = Date.now() - startTime;
      const inputCostPer1M = 0.15;
      const outputCostPer1M = 0.60;
      const estimatedCost =
        (aiResult.inputTokens / 1_000_000) * inputCostPer1M +
        (aiResult.outputTokens / 1_000_000) * outputCostPer1M;

      await this.prisma.$transaction(async (tx) => {
        await tx.qualificationResult.upsert({
          where: { inboundMessageId },
          update: {
            finalStatus,
            finalLayer: QualificationLayer.AI_CLASSIFIER,
            ruleScore: 0,
            matchedKeywords: [],
            matchedRuleIds: [],
            ruleReason: finalStatus === QualificationStatus.NEEDS_REVIEW && !aiResult.isLead
              ? 'AI did not find strong lead intent; routed to manual review to avoid message loss.'
              : null,
            sentToAI: true,
            aiConfidence: aiResult.confidence,
            aiReason: aiResult.reason,
            intent: this.toEnquiryIntent(aiResult.intent),
            urgency: aiResult.urgency,
            priority: aiResult.priority,
            extractedData: aiResult.extractedData as any,
            detectedLanguage: aiResult.detectedLanguage,
            aiInputTokens: aiResult.inputTokens,
            aiOutputTokens: aiResult.outputTokens,
            estimatedCostUsd: estimatedCost,
            processingTimeMs,
          },
          create: {
            inboundMessageId,
            finalStatus,
            finalLayer: QualificationLayer.AI_CLASSIFIER,
            ruleScore: 0,
            matchedKeywords: [],
            matchedRuleIds: [],
            ruleReason: finalStatus === QualificationStatus.NEEDS_REVIEW && !aiResult.isLead
              ? 'AI did not find strong lead intent; routed to manual review to avoid message loss.'
              : null,
            sentToAI: true,
            aiConfidence: aiResult.confidence,
            aiReason: aiResult.reason,
            intent: this.toEnquiryIntent(aiResult.intent),
            urgency: aiResult.urgency,
            priority: aiResult.priority,
            extractedData: aiResult.extractedData as any,
            detectedLanguage: aiResult.detectedLanguage,
            aiInputTokens: aiResult.inputTokens,
            aiOutputTokens: aiResult.outputTokens,
            estimatedCostUsd: estimatedCost,
            processingTimeMs,
          },
        });

        await tx.inboundMessage.update({
          where: { id: inboundMessageId },
          data: { status: finalStatus },
        });
      });

      this.logger.log(
        `Qualified: ${finalStatus} | confidence: ${aiResult.confidence} | intent: ${aiResult.intent} | ${processingTimeMs}ms | ~$${estimatedCost.toFixed(6)}`,
      );

      if (finalStatus === QualificationStatus.REAL_ENQUIRY) {
        this.eventEmitter.emit('enquiry.qualified', {
          inboundMessageId,
          contactId: message.contactId,
          intent: aiResult.intent,
          urgency: aiResult.urgency,
          priority: aiResult.priority,
          extractedData: aiResult.extractedData,
        });
      }
    } catch (error) {
      this.logger.error(`âŒ Qualification failed for ${inboundMessageId}: ${error.message}`);

      const processingTimeMs = Date.now() - startTime;

      await this.prisma.$transaction(async (tx) => {
        await tx.inboundMessage.update({
          where: { id: inboundMessageId },
          data: { status: QualificationStatus.NEEDS_REVIEW },
        });

        await tx.qualificationResult.upsert({
          where: { inboundMessageId },
          update: {
            finalStatus: QualificationStatus.NEEDS_REVIEW,
            finalLayer: QualificationLayer.AI_CLASSIFIER,
            ruleReason: `Error: ${error.message}`,
            sentToAI: false,
            processingTimeMs,
          },
          create: {
            inboundMessageId,
            finalStatus: QualificationStatus.NEEDS_REVIEW,
            finalLayer: QualificationLayer.AI_CLASSIFIER,
            ruleReason: `Error: ${error.message}`,
            sentToAI: false,
            processingTimeMs,
          },
        });
      });
    }
  }

  private toEnquiryIntent(intent: string): EnquiryIntent | undefined {
    const validIntents: Record<string, EnquiryIntent> = {
      'PRODUCT_INQUIRY': EnquiryIntent.PRODUCT_INQUIRY,
      'PRICING_REQUEST': EnquiryIntent.PRICING_REQUEST,
      'BULK_ORDER': EnquiryIntent.BULK_ORDER,
      'SHIPPING_INQUIRY': EnquiryIntent.SHIPPING_INQUIRY,
      'GENERAL_INFO': EnquiryIntent.GENERAL_INFO,
      'COMPLAINT': EnquiryIntent.COMPLAINT,
      'APPOINTMENT': EnquiryIntent.APPOINTMENT,
      'DOCUMENT_SUBMIT': EnquiryIntent.DOCUMENT_SUBMIT,
      'RETURN_REFUND': EnquiryIntent.RETURN_REFUND,
      'PARTNERSHIP': EnquiryIntent.PARTNERSHIP,
      'UNKNOWN': EnquiryIntent.UNKNOWN,
    };
    return validIntents[intent] || EnquiryIntent.UNKNOWN;
  }
}
