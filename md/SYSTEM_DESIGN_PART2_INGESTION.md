# 🔌 Part 2: Ingestion Module — Raw Message Intake

> Receives parsed webhook data, saves to `InboundMessage`, queues qualification job via BullMQ.

---

## File Structure

```
src/ingestion/
├── ingestion.module.ts
├── ingestion.service.ts
├── ingestion.controller.ts
└── dto/
    └── ingest-message.dto.ts
```

---

## `src/ingestion/dto/ingest-message.dto.ts`

```typescript
import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { MessageChannel } from '@prisma/client';

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

## `src/ingestion/ingestion.service.ts`

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
import { InboundMessage, QualificationStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('qualification') private qualificationQueue: Queue,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Ingest a parsed inbound message.
   *
   * 1. Idempotency check (channel + externalId)
   * 2. Create InboundMessage with status PENDING
   * 3. Queue qualification job
   * 4. Emit lifecycle event
   */
  async ingest(dto: IngestMessageDto): Promise<InboundMessage> {
    // ── 1. Idempotency: Prevent duplicate webhook processing ──
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
        throw new ConflictException(
          'Message already ingested',
        );
      }
    }

    // ── 2. Create InboundMessage ──
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        status: QualificationStatus.PENDING,
      },
    });

    this.logger.log(
      `📨 Ingested message ${inboundMessage.id} from ${dto.channel}:${dto.from}`,
    );

    // ── 3. Queue qualification job ──
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

    // ── 4. Emit lifecycle event (optional consumers) ──
    this.eventEmitter.emit('inbound.message.received', {
      inboundMessageId: inboundMessage.id,
      channel: dto.channel,
      from: dto.from,
    });

    return inboundMessage;
  }

  /**
   * Re-queue a message for re-qualification (admin action).
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
}
```

---

## `src/ingestion/ingestion.controller.ts`

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
   * Ingest a raw message for qualification.
   * Public endpoint (called by webhook handlers).
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

## `src/ingestion/ingestion.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'qualification',
    }),
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
```

---

**Continue to [Part 3: Qualification Module](./SYSTEM_DESIGN_PART3_QUALIFICATION.md)**
