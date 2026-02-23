import {
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { AIClassifierStrategy } from './strategies/ai.strategy';
import {
    QualificationStatus,
    QualificationLayer,
    EnquiryIntent,
} from '@prisma/client';

// ═══════════════════════════════════════════════════════════════════
// Qualification Service — AI-Only Pipeline
//
// Called by BullMQ processor for every new inbound message that
// doesn't have an open enquiry (i.e., first message from a new person).
//
// FLOW:
//   1. Load the inbound message
//   2. Check if already processed (idempotency)
//   3. Mark as PROCESSING
//   4. Send to AI Classifier
//   5. Save result
//   6. If REAL_ENQUIRY → emit event (EnquiryService creates the enquiry)
//
// WHY NO RULE ENGINE:
//   For now, AI alone is more accurate and simpler.
//   Rule engine can be added later as a pre-filter to reduce AI costs
//   when message volume grows.
// ═══════════════════════════════════════════════════════════════════
   
@Injectable()
export class QualificationService {
    private readonly logger = new Logger(QualificationService.name);
    private readonly confidenceThreshold: number;

    constructor(
        private prisma: PrismaService,
        private aiClassifier: AIClassifierStrategy,
        private eventEmitter: EventEmitter2,
        private config: ConfigService,
    ) {
        this.confidenceThreshold = this.config.get<number>(
            'QUALIFICATION_AI_CONFIDENCE_THRESHOLD',
            65,
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // CORE: Qualify an inbound message
    // ═══════════════════════════════════════════════════════════════════

    async qualify(inboundMessageId: string): Promise<void> {
        const startTime = Date.now();

        // 1. Load the message
        const message = await this.prisma.inboundMessage.findUnique({
            where: { id: inboundMessageId },
        });

        if (!message) {
            throw new NotFoundException(`InboundMessage ${inboundMessageId} not found`);
        }

        // 2. Idempotency: skip if already processed

        // 3. Mark as PROCESSING (prevents duplicate processing)
        await this.prisma.inboundMessage.update({
            where: { id: inboundMessageId },
            data: { status: QualificationStatus.PROCESSING },
        });

        try {
            // 4. Send to AI Classifier
            const aiResult = await this.aiClassifier.classify({
                body: message.body,
                subject: message.subject,
                from: message.from,
                channel: message.channel,
            });

            // 5. Determine final status based on AI result
            let finalStatus: QualificationStatus;
            console.log("airesult confidence", aiResult.confidence)
            if (aiResult.confidence === 0) {
                // AI failed completely → manual review
                finalStatus = QualificationStatus.NEEDS_REVIEW;
            } else if (aiResult.isLead && aiResult.confidence >= this.confidenceThreshold) {
                // AI is confident it's a real lead
                finalStatus = QualificationStatus.REAL_ENQUIRY;
            } else if (!aiResult.isLead && aiResult.confidence >= this.confidenceThreshold) {
                // AI is confident it's spam
                finalStatus = QualificationStatus.SPAM;
            } else {
                // AI is not confident enough → human must decide
                finalStatus = QualificationStatus.NEEDS_REVIEW;
            }

            // 6. Update contact name if AI extracted it
            if (aiResult.extractedData?.contactName && message.contactId) {
                await this.prisma.contact.update({
                    where: { id: message.contactId },
                    data: {
                        displayName: aiResult.extractedData.contactName,
                    },
                }).catch(() => {
                    // Non-critical — don't fail qualification if name update fails
                });
            }

            // 7. Save qualification result
            const processingTimeMs = Date.now() - startTime;

            // Calculate estimated cost (Gemini 2.5 Flash pricing)
            const inputCostPer1M = 0.15;  // $0.15 per 1M input tokens
            const outputCostPer1M = 0.60; // $0.60 per 1M output tokens
            const estimatedCost =
                (aiResult.inputTokens / 1_000_000) * inputCostPer1M +
                (aiResult.outputTokens / 1_000_000) * outputCostPer1M;

            await this.prisma.$transaction(async (tx) => {
                // Save the detailed result
                await tx.qualificationResult.create({
                    data: {
                        inboundMessageId,
                        finalStatus,
                        finalLayer: QualificationLayer.AI_CLASSIFIER,
                        ruleScore: 0,
                        matchedKeywords: [],
                        matchedRuleIds: [],
                        ruleReason: null,
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

                // Update the message status
                await tx.inboundMessage.update({
                    where: { id: inboundMessageId },
                    data: { status: finalStatus },
                });
            });

            this.logger.log(
                `📊 Qualified: ${finalStatus} | confidence: ${aiResult.confidence} | intent: ${aiResult.intent} | ${processingTimeMs}ms | ~$${estimatedCost.toFixed(6)}`,
            );

            // 8. If it's a real enquiry → emit event for EnquiryService
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
            this.logger.error(`❌ Qualification failed for ${inboundMessageId}: ${error.message}`);

            // Fail-safe: send to review queue (never lose a message)
            const processingTimeMs = Date.now() - startTime;

            await this.prisma.inboundMessage.update({
                where: { id: inboundMessageId },
                data: { status: QualificationStatus.NEEDS_REVIEW },
            });

            await this.prisma.qualificationResult.create({
                data: {
                    inboundMessageId,
                    finalStatus: QualificationStatus.NEEDS_REVIEW,
                    finalLayer: QualificationLayer.AI_CLASSIFIER,
                    ruleReason: `Error: ${error.message}`,
                    sentToAI: false,
                    processingTimeMs,
                },
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HELPER: Convert AI intent string to Prisma enum
    // ═══════════════════════════════════════════════════════════════════

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
