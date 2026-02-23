# 🔌 Part 3: Ingestion Module — Contact-Aware Message Intake

> Receives parsed webhook data, **resolves the Contact identity**, saves to `InboundMessage` with `contactId`, and queues the qualification job.

---

## What Changed from v1

| v1 (Before) | v2 (Now) |
|-------------|----------|
| Just saves message and queues | Resolves Contact FIRST, then saves + queues |
| No `contactId` on InboundMessage | Every InboundMessage has a `contactId` |
| Duplicate check: only `externalId` | Also checks content fingerprint (Rule Engine v2) |

---

## File Structure

```
src/modules/ingestion/
├── ingestion.module.ts
├── ingestion.service.ts
├── ingestion.controller.ts
└── dto/
    └── ingest-message.dto.ts
```

---

## `src/modules/ingestion/dto/ingest-message.dto.ts`

```typescript
import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { MessageChannel } from '@prisma/client';

/**
 * Represents a parsed inbound message ready for ingestion.
 * Created by webhook controllers after parsing the raw webhook payload.
 *
 * WHERE THIS DTO IS USED:
 *   WebhookController.ingestEmail()  → creates this DTO from email webhook
 *   WebhookController.ingestWhatsApp() → creates this DTO from WA webhook
 *   IngestionController.ingestMessage() → direct ingestion API
 */
export class IngestMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsOptional()
  @IsString()
  externalId?: string; // WhatsApp message ID, email Message-ID, etc.

  @IsString()
  from: string; // Phone number or email address

  @IsOptional()
  @IsString()
  to?: string; // Your receiving number/email

  @IsOptional()
  @IsString()
  subject?: string; // Email subject (strong qualifying signal)

  @IsString()
  body: string; // The actual message text

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, any>; // Full webhook payload for debugging
}
```

---

## `src/modules/ingestion/ingestion.service.ts`

```typescript
import {
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IngestMessageDto } from './dto/ingest-message.dto';
import { ContactService } from '../contact/contact.service';
import { InboundMessage, QualificationStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('qualification') private qualificationQueue: Queue,
    private contactService: ContactService, // ← NEW: injected from ContactModule
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Ingest a parsed inbound message.
   *
   * FLOW:
   *   1. Idempotency check (channel + externalId — prevents duplicate webhook processing)
   *   2. Resolve Contact (find or create the person sending this message)
   *   3. Generate content fingerprint (for duplicate detection in Rule Engine)
   *   4. Create InboundMessage with contactId + fingerprint
   *   5. Queue qualification job
   *   6. Emit lifecycle event
   */
  async ingest(dto: IngestMessageDto): Promise<InboundMessage> {
    // ── 1. Idempotency: Prevent duplicate webhook processing ──
    // WHY: Webhooks can fire multiple times for the same event.
    //      The unique constraint on [channel, externalId] catches this.
    if (dto.externalId) {
      const existing = await this.prisma.inboundMessage.findUnique({
        where: {
          channel_externalId: {
            channel: dto.channel,
            externalId: dto.externalId,
          },
        },
      });

      if (existing) {
        this.logger.warn(
          `Duplicate message detected: ${dto.channel}/${dto.externalId}`,
        );
        throw new ConflictException('Message already ingested');
      }
    }

    // ── 2. Resolve Contact ──
    // WHO is sending this message? Find their Contact or create a new one.
    const { contactId, isNew } = await this.contactService.resolve(
      dto.channel,
      dto.from,
    );

    if (isNew) {
      this.logger.log(`🆕 New contact created for ${dto.channel}:${dto.from}`);
    }

    // ── 3. Generate content fingerprint ──
    // Used by Rule Engine v2 for duplicate detection.
    // Normalises text: lowercase, strip punctuation, collapse whitespace.
    const contentFingerprint = this.generateFingerprint(dto.body, dto.from);

    // ── 4. Create InboundMessage ──
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        contentFingerprint,
        status: QualificationStatus.PENDING,
        contactId, // ← NEW: linked to Contact
      },
    });

    this.logger.log(
      `📨 Ingested message ${inboundMessage.id} from ${dto.channel}:${dto.from} (contact: ${contactId})`,
    );

    // ── 5. Queue qualification job ──
    // The QualificationProcessor will pick this up asynchronously.
    await this.qualificationQueue.add(
      'qualify',
      { inboundMessageId: inboundMessage.id },
      {
        jobId: `qualify-${inboundMessage.id}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );

    // ── 6. Emit lifecycle event (optional consumers) ──
    this.eventEmitter.emit('inbound.message.received', {
      inboundMessageId: inboundMessage.id,
      contactId,
      channel: dto.channel,
      from: dto.from,
    });

    return inboundMessage;
  }

  /**
   * Re-queue a message for re-qualification (admin action).
   * Used when rules change and you want to re-evaluate old messages.
   */
  async requalify(inboundMessageId: string): Promise<void> {
    await this.prisma.inboundMessage.update({
      where: { id: inboundMessageId },
      data: { status: QualificationStatus.PENDING },
    });

    await this.qualificationQueue.add(
      'qualify',
      { inboundMessageId },
      {
        jobId: `requalify-${inboundMessageId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  /**
   * Generate a content fingerprint for duplicate detection.
   *
   * WHY: The same person might send the exact same message twice
   *      (e.g., WhatsApp message retry). The Rule Engine uses this
   *      fingerprint to detect and flag duplicates.
   *
   * HOW: Normalise text (lowercase, strip punctuation, collapse spaces),
   *      include sender for per-sender scoping, SHA-256 hash, take first 16 chars.
   */
  private generateFingerprint(body: string, from: string): string {
    const normalised = body
      .toLowerCase()
      .replace(/[^\w\s]/g, '')   // Strip punctuation
      .replace(/\s+/g, ' ')      // Collapse whitespace
      .trim();

    const input = `${from.toLowerCase()}::${normalised}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }
}
```

---

## `src/modules/ingestion/ingestion.controller.ts`

```typescript
import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { IngestMessageDto } from './dto/ingest-message.dto';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency.interceptor';
import { Public } from 'src/common/decorator/public.decorator';

@Controller('ingestion')
export class IngestionController {
  constructor(private ingestionService: IngestionService) {}

  /**
   * POST /api/v1/ingestion/message
   * Direct message ingestion endpoint.
   * Public: called by webhook handlers (no auth needed).
   */
  @Post('message')
  @Public()
  @UseGuards(IdempotencyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.ACCEPTED)
  ingestMessage(@Body() dto: IngestMessageDto) {
    return this.ingestionService.ingest(dto);
  }
}
```

---

## `src/modules/ingestion/ingestion.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [
    // Register the qualification queue (jobs are added here, processed in QualificationModule)
    BullModule.registerQueue({
      name: 'qualification',
    }),
    // Import ContactModule to use ContactService.resolve()
    ContactModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
```

---

## Data Flow Diagram

```
Webhook: WhatsApp message from +91-9876543210
                │
                ▼
  IngestionService.ingest({
    channel: WHATSAPP,
    from: "+91-9876543210",
    body: "What is the price for your premium widget?",
    externalId: "wamid_abc123"
  })
                │
                ├── 1. Idempotency check: wamid_abc123 exists? NO → continue
                │
                ├── 2. ContactService.resolve(WHATSAPP, "+91-9876543210")
                │      └── ContactChannel lookup → FOUND → contactId: "contact-001"
                │
                ├── 3. generateFingerprint("What is the price for your premium widget?", "+91-9876543210")
                │      └── "a3f8d2e1b9c04567"
                │
                ├── 4. InboundMessage.create({
                │        channel: WHATSAPP,
                │        from: "+91-9876543210",
                │        body: "What is the price for your premium widget?",
                │        contactId: "contact-001",           ← linked to Contact
                │        contentFingerprint: "a3f8d2e1...",  ← for duplicate detection
                │        status: PENDING
                │      })
                │
                ├── 5. qualificationQueue.add("qualify", { inboundMessageId: "msg-001" })
                │
                └── 6. eventEmitter.emit("inbound.message.received", { ... })
```

---

**Continue to [Part 4: Qualification Module →](./PART4_QUALIFICATION_MODULE.md)**
