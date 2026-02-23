# ⚡ Part 3: Qualification Module — The Intelligence Engine

> 3-layer qualification: Rule Engine → AI Classifier → Manual Review. BullMQ processor for async, strategies pattern for extensibility.

---

## File Structure

```
src/qualification/
├── qualification.module.ts
├── qualification.service.ts
├── qualification.controller.ts
├── strategies/
│   ├── rule-engine.strategy.ts
│   └── ai-classifier.strategy.ts
├── processors/
│   └── qualification.processor.ts
└── dto/
    ├── create-rule.dto.ts
    ├── manual-review.dto.ts
    └── stats-query.dto.ts
```

---

## DTOs

### `src/qualification/dto/create-rule.dto.ts`

```typescript
import {
  IsEnum,
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { RuleType } from '@prisma/client';

export class CreateRuleDto {
  @IsEnum(RuleType)
  type: RuleType;

  @IsString()
  value: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isCaseSensitive?: boolean;
}
```

### `src/qualification/dto/manual-review.dto.ts`

```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReviewDecision {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class ManualReviewDto {
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  reason?: string;
}
```

### `src/qualification/dto/stats-query.dto.ts`

```typescript
import { IsOptional, IsDateString } from 'class-validator';

export class StatsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
```

---

## `src/qualification/strategies/rule-engine.strategy.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {
  QualificationRule,
  RuleType,
  QualificationStatus,
  QualificationLayer,
} from '@prisma/client';

export interface RuleResult {
  status: QualificationStatus;
  layer: QualificationLayer;
  score: number;
  matchedKeywords: string[];
  reason: string;
}

@Injectable()
export class RuleEngineStrategy {
  private readonly logger = new Logger(RuleEngineStrategy.name);
  private rulesCache: QualificationRule[] = [];
  private lastCacheRefresh = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}

  /**
   * Evaluate a message against all active rules.
   * Returns RuleResult if conclusive, null if ambiguous (needs AI).
   */
  async evaluate(message: {
    body: string;
    subject?: string | null;
    from: string;
  }): Promise<RuleResult | null> {
    const rules = await this.loadRules();
    const text = `${message.subject || ''} ${message.body}`.trim();
    const textLower = text.toLowerCase();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // ── Layer 1a: Short text check ──
    if (wordCount < 4) {
      this.logger.debug(`Short text detected (${wordCount} words) → SPAM`);
      return {
        status: QualificationStatus.SPAM,
        layer: QualificationLayer.RULE_SHORTTEXT,
        score: 0,
        matchedKeywords: [],
        reason: `Message too short (${wordCount} words). .`,
      };Likely auto-reply or noise
    }

    // ── Layer 1b: Blacklist check ──
    const blacklistKeywords = rules.filter(
      (r) => r.type === RuleType.BLACKLIST_KEYWORD && r.isActive,
    );
    const blacklistPhrases = rules.filter(
      (r) => r.type === RuleType.BLACKLIST_PHRASE && r.isActive,
    );

    for (const rule of blacklistKeywords) {
      const searchValue = rule.isCaseSensitive ? rule.value : rule.value.toLowerCase();
      const searchText = rule.isCaseSensitive ? text : textLower;

      if (searchText.includes(searchValue)) {
        this.logger.debug(`Blacklist keyword matched: "${rule.value}" → SPAM`);
        return {
          status: QualificationStatus.SPAM,
          layer: QualificationLayer.RULE_BLACKLIST,
          score: 0,
          matchedKeywords: [rule.value],
          reason: `Blacklist keyword matched: "${rule.value}"`,
        };
      }
    }

    for (const rule of blacklistPhrases) {
      const searchValue = rule.isCaseSensitive ? rule.value : rule.value.toLowerCase();
      const searchText = rule.isCaseSensitive ? text : textLower;

      if (searchText.includes(searchValue)) {
        this.logger.debug(`Blacklist phrase matched: "${rule.value}" → SPAM`);
        return {
          status: QualificationStatus.SPAM,
          layer: QualificationLayer.RULE_BLACKLIST,
          score: 0,
          matchedKeywords: [rule.value],
          reason: `Blacklist phrase matched: "${rule.value}"`,
        };
      }
    }

    // ── Layer 1c: Regex pattern check ──
    const regexRules = rules.filter(
      (r) => r.type === RuleType.REGEX_PATTERN && r.isActive,
    );

    for (const rule of regexRules) {
      try {
        const flags = rule.isCaseSensitive ? 'g' : 'gi';
        const regex = new RegExp(rule.value, flags);
        if (regex.test(text)) {
          this.logger.debug(`Regex pattern matched: "${rule.description}" → SPAM`);
          return {
            status: QualificationStatus.SPAM,
            layer: QualificationLayer.RULE_PATTERN,
            score: 0,
            matchedKeywords: [rule.value],
            reason: `Spam pattern detected: ${rule.description || rule.value}`,
          };
        }
      } catch (err) {
        this.logger.warn(`Invalid regex rule ${rule.id}: ${rule.value}`);
      }
    }

    // ── Layer 2: Whitelist keyword scoring ──
    const whitelistRules = rules.filter(
      (r) => r.type === RuleType.WHITELIST_KEYWORD && r.isActive,
    );

    let totalScore = 0;
    const matchedKeywords: string[] = [];

    for (const rule of whitelistRules) {
      const searchValue = rule.isCaseSensitive ? rule.value : rule.value.toLowerCase();
      const searchText = rule.isCaseSensitive ? text : textLower;

      if (searchText.includes(searchValue)) {
        totalScore += rule.weight;
        matchedKeywords.push(rule.value);
      }
    }

    // If keyword score is high enough, it's definitely a real enquiry
    const KEYWORD_THRESHOLD = parseInt(
      process.env.QUALIFICATION_KEYWORD_SCORE_THRESHOLD || '30',
      10,
    );

    if (totalScore >= KEYWORD_THRESHOLD) {
      this.logger.debug(
        `Keyword score ${totalScore} ≥ ${KEYWORD_THRESHOLD} → REAL_ENQUIRY`,
      );
      return {
        status: QualificationStatus.REAL_ENQUIRY,
        layer: QualificationLayer.RULE_WHITELIST,
        score: totalScore,
        matchedKeywords,
        reason: `Keyword score ${totalScore} (threshold: ${KEYWORD_THRESHOLD}). Matched: ${matchedKeywords.join(', ')}`,
      };
    }

    // ── Ambiguous: Rules couldn't decide → needs AI ──
    this.logger.debug(
      `Rules inconclusive (score: ${totalScore}). Forwarding to AI classifier.`,
    ); 
    return null;
  }

  /**
   * Load rules with in-memory caching (refreshes every 5 min).
   */
  private async loadRules(): Promise<QualificationRule[]> {
    const now = Date.now();
    if (now - this.lastCacheRefresh > this.CACHE_TTL || this.rulesCache.length === 0) {
      this.rulesCache = await this.prisma.qualificationRule.findMany({
        where: { isActive: true },
        orderBy: { weight: 'desc' },
      });
      this.lastCacheRefresh = now;
      this.logger.debug(`Rules cache refreshed: ${this.rulesCache.length} rules loaded`);
    }
    return this.rulesCache;
  }

  /**
   * Force cache refresh (called when rules are CRUD'd).
   */
  invalidateCache(): void {
    this.lastCacheRefresh = 0;
  }
}
```

---

## `src/qualification/strategies/ai-classifier.strategy.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface AIClassificationResult {
  isLead: boolean;
  confidence: number;       // 0-100
  intent: string;           // Maps to EnquiryIntent enum
  urgency: number;          // 1-5
  priority: number;         // 1-10
  reason: string;
  extractedData: {
    companyName?: string;
    contactName?: string;
    productMentioned?: string[];
    budgetSignal?: string;
    quantitySignal?: string;
    timelineSignal?: string;
  };
  detectedLanguage: string;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class AIClassifierStrategy {
  private readonly logger = new Logger(AIClassifierStrategy.name);
  private client: Anthropic;
  private businessContext: string;

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow('ANTHROPIC_API_KEY'),
    });
    this.businessContext = this.config.get(
      'QUALIFICATION_BUSINESS_CONTEXT',
      'a B2B wholesale business',
    );
  }

  /**
   * Classify a message using Claude AI.
   */
  async classify(message: {
    body: string;
    subject?: string | null;
    from: string;
    channel: string;
  }): Promise<AIClassificationResult> {
    const startTime = Date.now();

    const prompt = this.buildPrompt(message);

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        system: `You are a lead qualification AI for ${this.businessContext}. Analyze messages and determine if they are genuine business enquiries or spam/noise. Respond ONLY with valid JSON, no markdown.`,
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected AI response type');
      }

      const parsed = JSON.parse(content.text);

      const result: AIClassificationResult = {
        isLead: parsed.isLead ?? false,
        confidence: Math.min(100, Math.max(0, parsed.confidence ?? 50)),
        intent: this.normalizeIntent(parsed.intent),
        urgency: Math.min(5, Math.max(1, parsed.urgency ?? 3)),
        priority: Math.min(10, Math.max(1, parsed.priority ?? 5)),
        reason: parsed.reason ?? 'AI classification complete',
        extractedData: {
          companyName: parsed.extractedData?.companyName,
          contactName: parsed.extractedData?.contactName,
          productMentioned: parsed.extractedData?.productMentioned,
          budgetSignal: parsed.extractedData?.budgetSignal,
          quantitySignal: parsed.extractedData?.quantitySignal,
          timelineSignal: parsed.extractedData?.timelineSignal,
        },
        detectedLanguage: parsed.detectedLanguage ?? 'en',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };

      this.logger.log(
        `🤖 AI classified: isLead=${result.isLead}, confidence=${result.confidence}%, intent=${result.intent} (${Date.now() - startTime}ms)`,
      );

      return result;
    } catch (error) {
      this.logger.error(`AI classification failed: ${error.message}`, error.stack);

      // Fail-safe: mark for human review instead of dropping
      return {
        isLead: false,
        confidence: 0,
        intent: 'UNKNOWN',
        urgency: 3,
        priority: 5,
        reason: `AI classification failed: ${error.message}. Sent to manual review.`,
        extractedData: {},
        detectedLanguage: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  private buildPrompt(message: {
    body: string;
    subject?: string | null;
    from: string;
    channel: string;
  }): string {
    return `Analyze this ${message.channel} message and determine if it's a genuine business enquiry.

FROM: ${message.from}
${message.subject ? `SUBJECT: ${message.subject}` : ''}
MESSAGE:
${message.body}

Respond with this exact JSON structure:
{
  "isLead": true/false,
  "confidence": 0-100,
  "intent": "PRICING_REQUEST" | "BULK_ORDER" | "PRODUCT_INQUIRY" | "APPOINTMENT" | "COMPLAINT" | "PARTNERSHIP" | "GENERAL_INFO" | "UNKNOWN",
  "urgency": 1-5,
  "priority": 1-10,
  "reason": "one sentence explaining your decision",
  "extractedData": {
    "companyName": "if mentioned",
    "contactName": "if mentioned",
    "productMentioned": ["list", "of", "products"],
    "budgetSignal": "any budget hints",
    "quantitySignal": "any quantity mentions",
    "timelineSignal": "any delivery/timeline mentions"
  },
  "detectedLanguage": "en/hi/ar/etc"
}

Rules:
- isLead=true means this person wants to BUY, ENQUIRE, or DO BUSINESS
- isLead=false means spam, auto-reply, personal chat, marketing
- confidence <50 means you're unsure, which triggers human review
- Be strict: only rate as lead if there's genuine commercial intent
- Extract ANY business-relevant data you can find`;
  }

  private normalizeIntent(raw: string): string {
    const validIntents = [
      'PRICING_REQUEST',
      'BULK_ORDER',
      'PRODUCT_INQUIRY',
      'APPOINTMENT',
      'COMPLAINT',
      'PARTNERSHIP',
      'GENERAL_INFO',
      'UNKNOWN',
    ];
    const upper = (raw || '').toUpperCase().replace(/\s+/g, '_');
    return validIntents.includes(upper) ? upper : 'UNKNOWN';
  }
}
```

---

## `src/qualification/processors/qualification.processor.ts`

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QualificationService } from '../qualification.service';

@Processor('qualification', {
  concurrency: 5,
  limiter: {
    max: 50,
    duration: 60000, // 50 jobs per minute (protects AI API rate limits)
  },
})
export class QualificationProcessor extends WorkerHost {
  private readonly logger = new Logger(QualificationProcessor.name);

  constructor(private qualificationService: QualificationService) {
    super();
  }

  /**
   * Process a qualification job.
   */
  async process(job: Job<{ inboundMessageId: string }>): Promise<void> {
    this.logger.log(
      `🔄 Processing qualification job ${job.id} for message ${job.data.inboundMessageId}`,
    );

    await this.qualificationService.qualify(job.data.inboundMessageId);

    this.logger.log(
      `✅ Qualification complete for message ${job.data.inboundMessageId}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `❌ Qualification job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }
}
```

---

## `src/qualification/qualification.service.ts`

```typescript
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { RuleEngineStrategy } from './strategies/rule-engine.strategy';
import { AIClassifierStrategy } from './strategies/ai-classifier.strategy';
import { CreateRuleDto } from './dto/create-rule.dto';
import { ReviewDecision } from './dto/manual-review.dto';
import {
  QualificationStatus,
  QualificationLayer,
  EnquiryIntent,
} from '@prisma/client';

@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private prisma: PrismaService,
    private ruleEngine: RuleEngineStrategy,
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
  // CORE: 3-Layer Qualification Pipeline
  // ═══════════════════════════════════════════════════════════════════

  async qualify(inboundMessageId: string): Promise<void> {
    const startTime = Date.now();

    // ── Load the inbound message ──
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });

    if (!message) {
      throw new NotFoundException(`InboundMessage ${inboundMessageId} not found`);
    }

    if (message.status !== QualificationStatus.PENDING) {
      this.logger.warn(
        `Message ${inboundMessageId} already processed (status: ${message.status}). Skipping.`,
      );
      return;
    }

    // ── Mark as PROCESSING ──
    await this.prisma.inboundMessage.update({
      where: { id: inboundMessageId },
      data: { status: QualificationStatus.PROCESSING },
    });

    try {
      // ── Layer 1 & 2: Rule Engine ──
      const ruleResult = await this.ruleEngine.evaluate({
        body: message.body,
        subject: message.subject,
        from: message.from,
      });

      if (ruleResult) {
        // Rules were conclusive
        await this.saveResult({
          inboundMessageId,
          finalStatus: ruleResult.status,
          finalLayer: ruleResult.layer,
          ruleScore: ruleResult.score,
          matchedKeywords: ruleResult.matchedKeywords,
          ruleReason: ruleResult.reason,
          sentToAI: false,
          processingTimeMs: Date.now() - startTime,
        });
        return;
      }

      // ── Layer 3: AI Classifier (rules were ambiguous) ──
      const aiResult = await this.aiClassifier.classify({
        body: message.body,
        subject: message.subject,
        from: message.from,
        channel: message.channel,
      });

      // Determine final status based on AI confidence
      let finalStatus: QualificationStatus;
      if (aiResult.confidence === 0) {
        // AI failed → manual review
        finalStatus = QualificationStatus.NEEDS_REVIEW;
      } else if (aiResult.isLead && aiResult.confidence >= this.confidenceThreshold) {
        finalStatus = QualificationStatus.REAL_ENQUIRY;
      } else if (!aiResult.isLead && aiResult.confidence >= this.confidenceThreshold) {
        finalStatus = QualificationStatus.SPAM;
      } else {
        // Low confidence → human review
        finalStatus = QualificationStatus.NEEDS_REVIEW;
      }

      await this.saveResult({
        inboundMessageId,
        finalStatus,
        finalLayer: QualificationLayer.AI_CLASSIFIER,
        ruleScore: 0,
        matchedKeywords: [],
        ruleReason: null,
        sentToAI: true,
        aiConfidence: aiResult.confidence,
        aiReason: aiResult.reason,
        intent: aiResult.intent as EnquiryIntent,
        urgency: aiResult.urgency,
        priority: aiResult.priority,
        extractedData: aiResult.extractedData,
        detectedLanguage: aiResult.detectedLanguage,
        aiInputTokens: aiResult.inputTokens,
        aiOutputTokens: aiResult.outputTokens,
        processingTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(
        `Qualification failed for ${inboundMessageId}: ${error.message}`,
        error.stack,
      );

      // Fail-safe: send to review queue rather than losing the message
      await this.prisma.inboundMessage.update({
        where: { id: inboundMessageId },
        data: { status: QualificationStatus.NEEDS_REVIEW },
      });

      await this.prisma.qualificationResult.create({
        data: {
          inboundMessageId,
          finalStatus: QualificationStatus.NEEDS_REVIEW,
          finalLayer: QualificationLayer.AI_CLASSIFIER,
          ruleReason: `Error during qualification: ${error.message}`,
          sentToAI: false,
          processingTimeMs: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Save qualification result + update message status + emit events.
   */
  private async saveResult(data: {
    inboundMessageId: string;
    finalStatus: QualificationStatus;
    finalLayer: QualificationLayer;
    ruleScore: number;
    matchedKeywords: string[];
    ruleReason: string | null;
    sentToAI: boolean;
    aiConfidence?: number;
    aiReason?: string;
    intent?: EnquiryIntent;
    urgency?: number;
    priority?: number;
    extractedData?: any;
    detectedLanguage?: string;
    aiInputTokens?: number;
    aiOutputTokens?: number;
    processingTimeMs: number;
  }): Promise<void> {
    // Calculate estimated cost (Claude Haiku pricing)
    const inputCostPer1k = 0.00025;
    const outputCostPer1k = 0.00125;
    const estimatedCost = data.sentToAI
      ? ((data.aiInputTokens || 0) / 1000) * inputCostPer1k +
        ((data.aiOutputTokens || 0) / 1000) * outputCostPer1k
      : 0;

    await this.prisma.$transaction(async (tx) => {
      // Create qualification result
      await tx.qualificationResult.create({
        data: {
          inboundMessageId: data.inboundMessageId,
          finalStatus: data.finalStatus,
          finalLayer: data.finalLayer,
          ruleScore: data.ruleScore,
          matchedKeywords: data.matchedKeywords,
          ruleReason: data.ruleReason,
          sentToAI: data.sentToAI,
          aiConfidence: data.aiConfidence,
          aiReason: data.aiReason,
          intent: data.intent,
          urgency: data.urgency,
          priority: data.priority,
          extractedData: data.extractedData,
          detectedLanguage: data.detectedLanguage,
          aiInputTokens: data.aiInputTokens,
          aiOutputTokens: data.aiOutputTokens,
          estimatedCostUsd: estimatedCost,
          processingTimeMs: data.processingTimeMs,
        },
      });

      // Update inbound message status
      await tx.inboundMessage.update({
        where: { id: data.inboundMessageId },
        data: { status: data.finalStatus },
      });
    });

    this.logger.log(
      `📊 Qualification result: ${data.finalStatus} via ${data.finalLayer} (${data.processingTimeMs}ms)`,
    );

    // ── Emit event for downstream consumers ──
    if (data.finalStatus === QualificationStatus.REAL_ENQUIRY) {
      this.eventEmitter.emit('enquiry.qualified', {
        inboundMessageId: data.inboundMessageId,
        intent: data.intent,
        urgency: data.urgency,
        priority: data.priority,
        extractedData: data.extractedData,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANUAL REVIEW
  // ═══════════════════════════════════════════════════════════════════

  async getReviewQueue(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.inboundMessage.findMany({
        where: { status: QualificationStatus.NEEDS_REVIEW },
        include: {
          qualificationResult: {
            select: {
              aiConfidence: true,
              aiReason: true,
              intent: true,
              ruleReason: true,
              ruleScore: true,
              matchedKeywords: true,
              extractedData: true,
            },
          },
        },
        orderBy: { receivedAt: 'asc' }, // FIFO
        skip,
        take: limit,
      }),
      this.prisma.inboundMessage.count({
        where: { status: QualificationStatus.NEEDS_REVIEW },
      }),
    ]);

    return {
      items: data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async manualReview(
    inboundMessageId: string,
    decision: ReviewDecision,
    reason: string | undefined,
    userId: string,
  ): Promise<void> {
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
      include: { qualificationResult: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (
      message.status !== QualificationStatus.NEEDS_REVIEW &&
      message.status !== QualificationStatus.SPAM &&
      message.status !== QualificationStatus.REAL_ENQUIRY
    ) {
      throw new BadRequestException(
        `Cannot review message in status: ${message.status}`,
      );
    }

    const newStatus =
      decision === ReviewDecision.APPROVE
        ? QualificationStatus.REVIEWED_APPROVED
        : QualificationStatus.REVIEWED_REJECTED;

    await this.prisma.$transaction(async (tx) => {
      // Update inbound message status
      await tx.inboundMessage.update({
        where: { id: inboundMessageId },
        data: { status: newStatus },
      });

      // Update qualification result with override info
      if (message.qualificationResult) {
        await tx.qualificationResult.update({
          where: { id: message.qualificationResult.id },
          data: {
            wasOverridden: true,
            overriddenTo: newStatus,
            overriddenBy: userId,
            overrideReason: reason,
            overriddenAt: new Date(),
            finalStatus: newStatus,
            finalLayer: QualificationLayer.MANUAL_OVERRIDE,
          },
        });
      }
    });

    // If approved → create enquiry
    if (decision === ReviewDecision.APPROVE) {
      this.eventEmitter.emit('enquiry.qualified', {
        inboundMessageId,
        intent: message.qualificationResult?.intent,
        urgency: message.qualificationResult?.urgency,
        priority: message.qualificationResult?.priority,
        extractedData: message.qualificationResult?.extractedData,
      });
    }

    this.logger.log(
      `👤 Manual review: ${decision.toUpperCase()} for message ${inboundMessageId} by ${userId}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RULES CRUD
  // ═══════════════════════════════════════════════════════════════════

  async createRule(data: CreateRuleDto, userId?: string) {
    const rule = await this.prisma.qualificationRule.create({
      data: {
        ...data,
        weight: data.weight ?? 10,
        createdBy: userId,
      },
    });
    this.ruleEngine.invalidateCache();
    return rule;
  }

  async getRules() {
    return this.prisma.qualificationRule.findMany({
      orderBy: [{ type: 'asc' }, { weight: 'desc' }],
    });
  }

  async toggleRule(id: string) {
    const rule = await this.prisma.qualificationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');

    const updated = await this.prisma.qualificationRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });
    this.ruleEngine.invalidateCache();
    return updated;
  }

  async deleteRule(id: string) {
    await this.prisma.qualificationRule.delete({ where: { id } });
    this.ruleEngine.invalidateCache();
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════

  async getStats(from?: string, to?: string) {
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const where = hasDateFilter ? { createdAt: dateFilter } : {};

    const [
      totalProcessed,
      statusBreakdown,
      layerBreakdown,
      intentBreakdown,
      avgConfidence,
      totalCost,
      avgProcessingTime,
      reviewQueueSize,
    ] = await Promise.all([
      this.prisma.qualificationResult.count({ where }),
      this.prisma.qualificationResult.groupBy({
        by: ['finalStatus'],
        where,
        _count: true,
      }),
      this.prisma.qualificationResult.groupBy({
        by: ['finalLayer'],
        where,
        _count: true,
      }),
      this.prisma.qualificationResult.groupBy({
        by: ['intent'],
        where: { ...where, intent: { not: null } },
        _count: true,
      }),
      this.prisma.qualificationResult.aggregate({
        where: { ...where, sentToAI: true },
        _avg: { aiConfidence: true },
      }),
      this.prisma.qualificationResult.aggregate({
        where,
        _sum: { estimatedCostUsd: true },
      }),
      this.prisma.qualificationResult.aggregate({
        where,
        _avg: { processingTimeMs: true },
      }),
      this.prisma.inboundMessage.count({
        where: { status: QualificationStatus.NEEDS_REVIEW },
      }),
    ]);

    return {
      totalProcessed,
      reviewQueueSize,
      statusBreakdown: statusBreakdown.reduce(
        (acc, item) => ({ ...acc, [item.finalStatus]: item._count }),
        {},
      ),
      layerBreakdown: layerBreakdown.reduce(
        (acc, item) => ({ ...acc, [item.finalLayer]: item._count }),
        {},
      ),
      intentBreakdown: intentBreakdown.reduce(
        (acc, item) => ({ ...acc, [item.intent ?? 'UNKNOWN']: item._count }),
        {},
      ),
      avgAIConfidence: Math.round(avgConfidence._avg.aiConfidence ?? 0),
      totalAICostUsd: Number(totalCost._sum.estimatedCostUsd ?? 0),
      avgProcessingTimeMs: Math.round(avgProcessingTime._avg.processingTimeMs ?? 0),
    };
  }
}
```

---

## `src/qualification/qualification.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { ManualReviewDto } from './dto/manual-review.dto';
import { StatsQueryDto } from './dto/stats-query.dto';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import type { Request } from 'express';

@Controller('qualification')
@UseGuards(CaslGuard)
export class QualificationController {
  constructor(private qualificationService: QualificationService) {}

  // ── Review Queue ──
  @Get('review-queue')
  @CheckAbility({ action: 'read', subject: 'QualificationResult' })
  getReviewQueue(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.qualificationService.getReviewQueue(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('review/:id')
  @CheckAbility({ action: 'update', subject: 'QualificationResult' })
  @HttpCode(HttpStatus.OK)
  manualReview(
    @Param('id') id: string,
    @Body() dto: ManualReviewDto,
    @Req() req: Request,
  ) {
    return this.qualificationService.manualReview(
      id,
      dto.decision,
      dto.reason,
      req.user!.userId,
    );
  }

  // ── Rules CRUD ──
  @Get('rules')
  @CheckAbility({ action: 'read', subject: 'QualificationRule' })
  getRules() {
    return this.qualificationService.getRules();
  }

  @Post('rules')
  @CheckAbility({ action: 'create', subject: 'QualificationRule' })
  createRule(@Body() dto: CreateRuleDto, @Req() req: Request) {
    return this.qualificationService.createRule(dto, req.user?.userId);
  }

  @Patch('rules/:id/toggle')
  @CheckAbility({ action: 'update', subject: 'QualificationRule' })
  toggleRule(@Param('id') id: string) {
    return this.qualificationService.toggleRule(id);
  }

  @Delete('rules/:id')
  @CheckAbility({ action: 'delete', subject: 'QualificationRule' })
  deleteRule(@Param('id') id: string) {
    return this.qualificationService.deleteRule(id);
  }

  // ── Stats ──
  @Get('stats')
  @CheckAbility({ action: 'read', subject: 'Dashboard' })
  getStats(@Query() query: StatsQueryDto) {
    return this.qualificationService.getStats(query.from, query.to);
  }
}
```

---

## `src/qualification/qualification.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QualificationService } from './qualification.service';
import { QualificationController } from './qualification.controller';
import { RuleEngineStrategy } from './strategies/rule-engine.strategy';
import { AIClassifierStrategy } from './strategies/ai-classifier.strategy';
import { QualificationProcessor } from './processors/qualification.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'qualification',
    }),
  ],
  controllers: [QualificationController],
  providers: [
    QualificationService,
    RuleEngineStrategy,
    AIClassifierStrategy,
    QualificationProcessor,
  ],
  exports: [QualificationService],
})
export class QualificationModule {}
```

---

**Continue to [Part 4: Enquiry Module](./SYSTEM_DESIGN_PART4_ENQUIRY.md)**
