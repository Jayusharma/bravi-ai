# 📋 Part 4: Enquiry Module — Event-Driven Lead Management

> Listens for `enquiry.qualified` events, creates enquiries, manages lifecycle with FSM, inbox views, tags, messages, and timeline.

---

## File Structure

```
src/enquiry/
├── enquiry.module.ts
├── enquiry.service.ts
├── enquiry.controller.ts
├── enquiry.state.ts            (keep existing FSM)
├── policy/
│   └── enquiry.policy.ts       (keep existing)
└── dto/
    ├── create-enquiry.dto.ts   (update)
    ├── update-status.dto.ts    (new)
    ├── assign.dto.ts           (new)
    ├── add-message.dto.ts      (new)
    └── inbox-query.dto.ts      (new)
```

---

## DTOs

### `src/enquiry/dto/create-enquiry.dto.ts` (REPLACE)

```typescript
import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  IsArray,
  MinLength,
} from 'class-validator';
import { EnquiryType, EnquiryStatus, EnquiryIntent } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * Manual enquiry creation (by sales team).
 */
export class CreateEnquiryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(EnquiryType)
  type?: EnquiryType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ChangeStatusDto {
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;

  @Type(() => Number)
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  lostReason?: string;
}

export class AssignEnquiryDto {
  @IsUUID()
  userId: string;

  @IsInt()
  version: number;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content: string;
}
```

### `src/enquiry/dto/inbox-query.dto.ts` (NEW)

```typescript
import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { EnquiryType, EnquiryStatus, EnquiryIntent } from '@prisma/client';
import { Type, Transform } from 'class-transformer';

export class InboxQueryDto {
  @IsOptional()
  @IsEnum(EnquiryType)
  type?: EnquiryType;

  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;

  @IsOptional()
  @IsEnum(EnquiryIntent)
  intent?: EnquiryIntent;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  assignedToMe?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
```

### `src/enquiry/dto/add-message.dto.ts` (NEW)

```typescript
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MessageChannel, MessageDirection } from '@prisma/client';

export class AddMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsOptional()
  @IsEnum(MessageDirection)
  direction?: MessageDirection;

  @IsString()
  from: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @MinLength(1)
  content: string;
}
```

---

## `src/enquiry/enquiry.service.ts` (REPLACE)

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CreateEnquiryDto,
  ChangeStatusDto,
  SendMessageDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
import {
  EnquiryStatus,
  EnquiryType,
  EnquiryIntent,
  Enquiry,
} from '@prisma/client';
import { automationQueue } from '../automation/automation.queue';
import { canSendMessage } from './policy/enquiry.policy';
import { randomUUID } from 'crypto';
import { AppAbility } from '../casl/casl.types';
import { accessibleBy } from '@casl/prisma';

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════
  // EVENT LISTENER: Create enquiry from qualified inbound message
  // ═══════════════════════════════════════════════════════════════════

  @OnEvent('enquiry.qualified')
  async createFromQualifiedMessage(payload: {
    inboundMessageId: string;
    intent?: EnquiryIntent;
    urgency?: number;
    priority?: number;
    extractedData?: any;
  }): Promise<Enquiry> {
    const { inboundMessageId, intent, urgency, priority, extractedData } = payload;

    // Check for duplicate
    const existing = await this.prisma.enquiry.findUnique({
      where: { inboundMessageId },
    });
    if (existing) {
      this.logger.warn(`Enquiry already exists for message ${inboundMessageId}`);
      return existing;
    }

    // Load the inbound message
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });

    if (!message) {
      throw new NotFoundException(`InboundMessage ${inboundMessageId} not found`);
    }

    // Create the enquiry with all context
    const enquiry = await this.prisma.enquiry.create({
      data: {
        type: EnquiryType.REAL,
        phone: message.channel === 'WHATSAPP' ? message.from : undefined,
        email: message.channel === 'EMAIL' ? message.from : undefined,
        name: extractedData?.contactName,
        intent: intent as EnquiryIntent,
        urgency,
        priority,
        inboundMessageId: message.id,
        timeline: {
          create: {
            type: 'CREATED',
            createdBy: 'SYSTEM',
            metadata: {
              source: 'qualification_pipeline',
              channel: message.channel,
              qualificationIntent: intent,
              qualificationPriority: priority,
            },
          },
        },
        // Create the first conversation message from the inbound message
        messages: {
          create: {
            channel: message.channel,
            direction: 'INBOUND',
            from: message.from,
            to: message.to ?? '',
            subject: message.subject,
            content: message.body,
            externalId: message.externalId,
          },
        },
      },
    });

    this.logger.log(
      `🎯 Enquiry ${enquiry.id} created from qualified message ${inboundMessageId} (intent: ${intent}, priority: ${priority})`,
    );

    return enquiry;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INBOX: Multi-type inbox with full filtering
  // ═══════════════════════════════════════════════════════════════════

  async getInbox(query: InboxQueryDto, ability: AppAbility, userId?: string) {
    const {
      type,
      status,
      intent,
      assignedToId,
      assignedToMe,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const permissionFilter = accessibleBy(ability).Enquiry;
    const conditions: any[] = [permissionFilter];

    if (type) conditions.push({ type });
    if (status) conditions.push({ status });
    if (intent) conditions.push({ intent });
    if (assignedToId) conditions.push({ assignedToId });
    if (assignedToMe && userId) conditions.push({ assignedToId: userId });

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { tags: { hasSome: [search] } },
        ],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * limit;

    // Build orderBy dynamically
    const allowedSortFields = ['createdAt', 'updatedAt', 'priority', 'urgency', 'status'];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const orderBy = { [orderField]: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        include: {
          assignedTo: {
            select: { id: true, userName: true, displayName: true },
          },
          inboundMessage: {
            select: { channel: true, from: true, body: true, subject: true, receivedAt: true },
          },
          _count: { select: { messages: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    return {
      items: data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // SINGLE ENQUIRY (with full details)
  // ═══════════════════════════════════════════════════════════════════

  async findOne(id: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, userName: true, displayName: true },
        },
        inboundMessage: {
          include: {
            qualificationResult: true,
          },
        },
        timeline: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    return {
      ...enquiry,
      allowedTransitions: ENQUIRY_TRANSITIONS[enquiry.status],
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD STATS (enhanced with qualification data)
  // ═══════════════════════════════════════════════════════════════════

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalEnquiries,
      newToday,
      unassigned,
      pendingFollowUps,
      convertedLast30,
      totalLast30,
      statusCounts,
      typeCounts,
      intentCounts,
      avgResponseTime,
    ] = await Promise.all([
      this.prisma.enquiry.count(),
      this.prisma.enquiry.count({
        where: { createdAt: { gte: today } },
      }),
      this.prisma.enquiry.count({
        where: { assignedToId: null, status: { not: 'CLOSED_LOST' } },
      }),
      this.prisma.enquiry.count({
        where: { status: 'FOLLOW_UP' },
      }),
      this.prisma.enquiry.count({
        where: {
          status: 'CONVERTED',
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.enquiry.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.enquiry.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.enquiry.groupBy({
        by: ['type'],
        _count: true,
      }),
      this.prisma.enquiry.groupBy({
        by: ['intent'],
        where: { intent: { not: null } },
        _count: true,
      }),
      // Average first response time (only for enquiries with a response)
      this.prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt"))) as avg_seconds
        FROM "Enquiry"
        WHERE "firstResponseAt" IS NOT NULL
        AND "createdAt" >= ${thirtyDaysAgo}
      ` as Promise<[{ avg_seconds: number | null }]>,
    ]);

    const conversionRate =
      totalLast30 > 0 ? Math.round((convertedLast30 / totalLast30) * 100) : 0;

    return {
      totalEnquiries,
      newToday,
      unassigned,
      pendingFollowUps,
      conversionRate,
      avgFirstResponseMinutes: avgResponseTime[0]?.avg_seconds
        ? Math.round(avgResponseTime[0].avg_seconds / 60)
        : null,
      statusBreakdown: statusCounts.reduce(
        (acc, item) => ({ ...acc, [item.status]: item._count }),
        {},
      ),
      typeBreakdown: typeCounts.reduce(
        (acc, item) => ({ ...acc, [item.type]: item._count }),
        {},
      ),
      intentBreakdown: intentCounts.reduce(
        (acc, item) => ({ ...acc, [item.intent ?? 'UNKNOWN']: item._count }),
        {},
      ),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CREATE (manual)
  // ═══════════════════════════════════════════════════════════════════

  async create(dto: CreateEnquiryDto, userId?: string) {
    return this.prisma.enquiry.create({
      data: {
        ...dto,
        type: dto.type ?? EnquiryType.REAL,
        timeline: {
          create: {
            type: 'CREATED',
            createdBy: userId ?? 'SYSTEM',
            metadata: { source: 'manual' },
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATUS CHANGE (FSM)
  // ═══════════════════════════════════════════════════════════════════

  async statusChange(
    id: string,
    dto: ChangeStatusDto,
    ability: AppAbility,
    userId?: string,
  ) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });

    if (!enquiry) throw new NotFoundException('Enquiry not found');

    if (enquiry.version !== dto.version) {
      throw new ConflictException(
        `Version conflict. Your: ${dto.version}, current: ${enquiry.version}`,
      );
    }

    const allowed = ENQUIRY_TRANSITIONS[enquiry.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${enquiry.status} to ${dto.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // Side effects
    if (dto.status === 'QUOTATION_SENT' || dto.status === 'FOLLOW_UP') {
      await automationQueue.add(
        'automation',
        { enquiryId: enquiry.id },
        {
          jobId: `followup_${enquiry.id}`,
          delay: dto.status === 'QUOTATION_SENT' ? 86400000 : 172800000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } else if (dto.status === 'CONVERTED' || dto.status === 'CLOSED_LOST') {
      await automationQueue.remove(`followup_${enquiry.id}`);
    }

    let eventType: string = 'STATUS_CHANGED';
    if (dto.status === 'CONVERTED') eventType = 'CONVERTED';
    if (dto.status === 'CLOSED_LOST') eventType = 'CLOSED';
    if (dto.status === 'OPEN' && enquiry.status === 'CLOSED_LOST') eventType = 'REOPENED';

    return this.prisma.enquiry.update({
      where: { id },
      data: {
        status: dto.status,
        version: { increment: 1 },
        lostReason: dto.status === 'CLOSED_LOST' ? dto.lostReason : undefined,
        timeline: {
          create: {
            type: eventType as any,
            fromStatus: enquiry.status,
            toStatus: dto.status,
            createdBy: userId,
            metadata: dto.lostReason ? { lostReason: dto.lostReason } : undefined,
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSIGN
  // ═══════════════════════════════════════════════════════════════════

  async assign(enquiryId: string, userId: string, version: number) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) throw new NotFoundException('Enquiry not found');

    if (enquiry.version !== version) {
      throw new ConflictException(
        `Version conflict. Your: ${version}, current: ${enquiry.version}`,
      );
    }

    const eventType = enquiry.assignedToId ? 'REASSIGNED' : 'ASSIGNED';

    return this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        assignedToId: userId,
        version: { increment: 1 },
        timeline: {
          create: {
            type: eventType,
            createdBy: 'SYSTEM',
            metadata: {
              previousAssignee: enquiry.assignedToId,
              newAssignee: userId,
            },
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════════════

  async addTag(enquiryId: string, tag: string, userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    if (enquiry.tags.includes(tag)) return enquiry;

    return this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        tags: { push: tag },
        timeline: {
          create: {
            type: 'TAG_ADDED',
            createdBy: userId,
            metadata: { tag },
          },
        },
      },
    });
  }

  async updateTags(enquiryId: string, tags: string[], userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    const addedTags = tags.filter((t) => !enquiry.tags.includes(t));
    const removedTags = enquiry.tags.filter((t) => !tags.includes(t));

    const timelineEntries = [
      ...addedTags.map((tag) => ({
        type: 'TAG_ADDED' as const,
        createdBy: userId,
        metadata: { tag },
      })),
      ...removedTags.map((tag) => ({
        type: 'TAG_REMOVED' as const,
        createdBy: userId,
        metadata: { tag },
      })),
    ];

    return this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        tags,
        timeline:
          timelineEntries.length > 0
            ? { createMany: { data: timelineEntries.map((e) => ({ ...e, enquiryId })) } }
            : undefined,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════════════════════════════════

  async addMessage(enquiryId: string, dto: AddMessageDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({
        where: { id: enquiryId },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found');

      const message = await tx.conversationMessage.create({
        data: {
          enquiryId,
          channel: dto.channel,
          direction: dto.direction ?? 'INBOUND',
          from: dto.from,
          to: dto.to,
          subject: dto.subject,
          content: dto.content,
        },
      });

      const isInbound = (dto.direction ?? 'INBOUND') === 'INBOUND';

      // Track customer reply time
      if (isInbound) {
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { lastCustomerReplyAt: new Date() },
        });
      }

      // Track first response time
      if (!isInbound && !enquiry.firstResponseAt) {
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { firstResponseAt: new Date() },
        });
      }

      await tx.enquiryTimeline.create({
        data: {
          enquiryId,
          type: isInbound ? 'MESSAGE_RECEIVED' : 'MESSAGE_SENT',
          createdBy: userId ?? 'SYSTEM',
          metadata: {
            messageId: message.id,
            channel: dto.channel,
            preview: dto.content.substring(0, 100),
          },
        },
      });

      return message;
    });
  }

  async sendMessage(
    enquiryId: string,
    dto: SendMessageDto,
    actor: { userId: string; role: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({
        where: { id: enquiryId },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found');

      if (!canSendMessage(actor, enquiry)) {
        throw new ForbiddenException(
          'You are not allowed to send messages for this enquiry',
        );
      }

      const message = await tx.conversationMessage.create({
        data: {
          enquiryId,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          externalId: `outbound-${randomUUID()}`,
          from: actor.userId,
          content: dto.content,
        },
      });

      await tx.enquiryTimeline.create({
        data: {
          enquiryId,
          type: 'MESSAGE_SENT',
          createdBy: actor.userId,
          metadata: { messageId: message.id, preview: dto.content.substring(0, 100) },
        },
      });

      if (!enquiry.firstResponseAt) {
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { firstResponseAt: new Date() },
        });
      }

      return message;
    });
  }

  async getMessages(enquiryId: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    return this.prisma.conversationMessage.findMany({
      where: { enquiryId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
```

---

## `src/enquiry/enquiry.controller.ts` (REPLACE)

```typescript
import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import {
  CreateEnquiryDto,
  SendMessageDto,
  ChangeStatusDto,
  AssignEnquiryDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { AddMessageDto } from './dto/add-message.dto';
import type { Request } from 'express';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';

@Controller('enquiry')
@UseGuards(CaslGuard)
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) {}

  /**
   * GET /enquiry — Unified inbox with type/status/intent filtering.
   * Use ?type=REAL for sales inbox, ?type=REVIEW for review inbox.
   */
  @Get()
  @CheckAbility({ action: 'read', subject: 'Enquiry' })
  getInbox(@Query() query: InboxQueryDto, @Req() req: Request) {
    return this.enquiryService.getInbox(query, req.ability, req.user?.userId);
  }

  @Get('stats')
  getStats() {
    return this.enquiryService.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.enquiryService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
    return this.enquiryService.create(dto, req.user?.userId);
  }

  @Patch(':id/status')
  @CheckAbility({ action: 'update', subject: 'Enquiry' })
  statusChange(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.statusChange(id, dto, req.ability, req.user?.userId);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignEnquiryDto) {
    return this.enquiryService.assign(id, dto.userId, dto.version);
  }

  @Patch(':id/tags')
  updateTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
    @Req() req: Request,
  ) {
    return this.enquiryService.updateTags(id, body.tags, req.user?.userId);
  }

  @Post(':id/tags')
  addTag(
    @Param('id') id: string,
    @Body() body: { tag: string },
    @Req() req: Request,
  ) {
    return this.enquiryService.addTag(id, body.tag, req.user?.userId);
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.sendMessage(id, dto, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string) {
    return this.enquiryService.getMessages(id);
  }
}
```

---

## `src/enquiry/enquiry.module.ts` (REPLACE)

```typescript
import { Module } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';

@Module({
  providers: [EnquiryService],
  controllers: [EnquiryController],
  exports: [EnquiryService],
})
export class EnquiryModule {}
```

> **Note:** `EventEmitterModule` is registered globally in `app.module.ts`, so `@OnEvent` works without importing it here.

---

**Continue to [Part 5: Webhook Updates & Testing](./SYSTEM_DESIGN_PART5_WEBHOOKS.md)**
