# 📋 Part 5: Enquiry Module — Conversation Threading & Lifecycle

> The core module. Listens for `enquiry.qualified` events, resolves whether to CREATE a new enquiry or APPEND to an existing one, manages the enhanced state machine, conversation view, internal notes, and tags.

---

## The Key Design Decision

```
Message qualifies as REAL_ENQUIRY
         ↓
   ContactService already resolved contactId (in Ingestion)
         ↓
   Does this Contact have an OPEN enquiry?
    ┌────┴────┐
   YES        NO
    │          │
    ▼          ▼
 APPEND      Create NEW
 message     Enquiry
 to existing (linked to Contact)
 enquiry
```

**"Open" means ANY status EXCEPT `CONVERTED` and `CLOSED_LOST`.**

---

## File Structure

```
src/modules/enquiry/
├── enquiry.module.ts
├── enquiry.service.ts
├── enquiry.controller.ts
├── enquiry.state.ts
├── policy/
│   └── enquiry.policy.ts
└── dto/
    ├── create-enquiry.dto.ts
    ├── inbox-query.dto.ts
    └── add-message.dto.ts
```

---

## `src/modules/enquiry/enquiry.state.ts`

```typescript
import { EnquiryStatus } from '@prisma/client';

/**
 * Enhanced State Machine — 10 states with defined transitions.
 *
 * VISUAL:
 *   NEW → OPEN → IN_PROGRESS → AWAITING_CUSTOMER → IN_PROGRESS (loop)
 *                IN_PROGRESS → QUOTATION_SENT → FOLLOW_UP → STALE
 *                IN_PROGRESS → CONVERTED ✅
 *                IN_PROGRESS → CLOSED_LOST ❌
 *                STALE → CLOSED_LOST (auto)
 *                CLOSED_LOST → OPEN (reopen)
 *
 * Each key is the CURRENT status.
 * The value is the list of statuses it CAN transition to.
 */
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW: [
    EnquiryStatus.OPEN,
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.AUTO_RESPONDED,
    EnquiryStatus.CLOSED_LOST,
  ],

  AUTO_RESPONDED: [
    EnquiryStatus.OPEN,
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  OPEN: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.QUOTATION_SENT,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  IN_PROGRESS: [
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.QUOTATION_SENT,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  AWAITING_CUSTOMER: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.STALE,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  QUOTATION_SENT: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  FOLLOW_UP: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.STALE,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  STALE: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.OPEN,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CLOSED_LOST,
  ],

  CONVERTED: [],       // Terminal state — no transitions out
  CLOSED_LOST: [
    EnquiryStatus.OPEN, // Can reopen a lost enquiry
  ],
};
```

---

## DTOs

### `src/modules/enquiry/dto/create-enquiry.dto.ts`

```typescript
import {
  IsEnum, IsOptional, IsString, IsArray, IsInt, IsUUID, MinLength,
} from 'class-validator';
import { EnquiryType, EnquiryStatus, EnquiryIntent } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * Manual enquiry creation (by sales team).
 * Requires a contactId — the person must exist first.
 */
export class CreateEnquiryDto {
  @IsUUID()
  contactId: string;

  @IsOptional()
  @IsEnum(EnquiryType)
  type?: EnquiryType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  initialMessage?: string; // Optional first message content
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

  @IsOptional()
  @IsString()
  channel?: string; // If not specified, uses last channel customer used

  @IsOptional()
  @IsString()
  templateId?: string; // If using a canned response
}

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  content: string;
}
```

### `src/modules/enquiry/dto/inbox-query.dto.ts`

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

### `src/modules/enquiry/dto/add-message.dto.ts`

```typescript
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MessageChannel, MessageDirection } from '@prisma/client';

/**
 * Add an inbound message to an existing enquiry's conversation.
 * Used when the qualification pipeline appends to an existing enquiry.
 */
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

  @IsOptional()
  @IsString()
  externalId?: string;
}
```

---

## `src/modules/enquiry/policy/enquiry.policy.ts`

```typescript
import { EnquiryStatus } from '@prisma/client';

/**
 * Business rules for who can do what on an enquiry.
 */
export function canSendMessage(
  actor: { userId: string; role: string },
  enquiry: { assignedToId: string | null; status: EnquiryStatus },
): boolean {
  // Admins and managers can always send
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return true;

  // Sales can only send on their own assigned enquiries
  if (enquiry.assignedToId === actor.userId) return true;

  return false;
}

/**
 * Check if an enquiry is in a "closed" state (no more appending).
 */
export function isEnquiryClosed(status: EnquiryStatus): boolean {
  return status === EnquiryStatus.CONVERTED || status === EnquiryStatus.CLOSED_LOST;
}
```

---

## `src/modules/enquiry/enquiry.service.ts`

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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { ContactService } from '../contact/contact.service';
import {
  CreateEnquiryDto,
  ChangeStatusDto,
  SendMessageDto,
  AddNoteDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
import { canSendMessage, isEnquiryClosed } from './policy/enquiry.policy';
import {
  EnquiryStatus,
  EnquiryType,
  EnquiryIntent,
  Enquiry,
  MessageChannel,
} from '@prisma/client';
import { AppAbility } from '../casl/casl.types';
import { accessibleBy } from '@casl/prisma';

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(
    private prisma: PrismaService,
    private contactService: ContactService,
    private eventEmitter: EventEmitter2,
    private config: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // EVENT LISTENER: Handle qualified inbound message
  //
  // THIS IS THE CORE LOGIC. When a message is qualified as REAL_ENQUIRY,
  // we decide: create a NEW enquiry or APPEND to existing?
  //
  // RULE: If Contact has an open enquiry → APPEND. Otherwise → CREATE.
  // ═══════════════════════════════════════════════════════════════════

  @OnEvent('enquiry.qualified')
  async handleQualified(payload: {
    inboundMessageId: string;
    contactId?: string | null;
    intent?: EnquiryIntent;
    urgency?: number;
    priority?: number;
    extractedData?: any;
  }): Promise<void> {
    const { inboundMessageId, contactId, intent, urgency, priority, extractedData } = payload;

    if (!contactId) {
      this.logger.error(`No contactId for message ${inboundMessageId} — cannot create enquiry`);
      return;
    }

    // Load the inbound message to get the actual content
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });

    if (!message) {
      this.logger.error(`InboundMessage ${inboundMessageId} not found`);
      return;
    }

    // ── Decision: Append or Create? ──
    const openEnquiryId = await this.contactService.findOpenEnquiry(contactId);

    if (openEnquiryId) {
      // ── APPEND to existing enquiry ──
      await this.appendToExistingEnquiry(openEnquiryId, message, intent);
    } else {
      // ── CREATE new enquiry ──
      await this.createNewEnquiry(contactId, message, intent, urgency, priority, extractedData);
    }

    // Update contact name if AI extracted it
    if (extractedData?.contactName) {
      await this.contactService.updateNameIfUnknown(contactId, extractedData.contactName);
    }
  }

  /**
   * Append a new message to an existing open enquiry.
   * This is what happens when the same person sends another message.
   */
  private async appendToExistingEnquiry(
    enquiryId: string,
    message: { id: string; channel: MessageChannel; from: string; to: string | null; subject: string | null; body: string; externalId: string | null },
    intent?: EnquiryIntent,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Add the message to the conversation thread
      await tx.conversationMessage.create({
        data: {
          enquiryId,
          channel: message.channel,
          direction: 'INBOUND',
          from: message.from,
          to: message.to ?? '',
          subject: message.subject,
          content: message.body,
          externalId: message.externalId,
          deliveryStatus: 'DELIVERED', // Inbound messages are already delivered
        },
      });

      // Update enquiry activity tracking
      const updateData: any = {
        lastCustomerReplyAt: new Date(),
        lastActivityAt: new Date(),
      };

      // If enquiry was AWAITING_CUSTOMER or STALE, move to IN_PROGRESS
      // (customer re-engaged!)
      const enquiry = await tx.enquiry.findUnique({
        where: { id: enquiryId },
        select: { status: true },
      });

      if (
        enquiry?.status === EnquiryStatus.AWAITING_CUSTOMER ||
        enquiry?.status === EnquiryStatus.STALE
      ) {
        updateData.status = EnquiryStatus.IN_PROGRESS;
      }

      // Update intent if AI provided a more specific one
      if (intent && intent !== 'UNKNOWN') {
        updateData.intent = intent;
      }

      await tx.enquiry.update({
        where: { id: enquiryId },
        data: updateData,
      });

      // Timeline entry
      await tx.enquiryTimeline.create({
        data: {
          enquiryId,
          type: 'MESSAGE_RECEIVED',
          createdBy: 'SYSTEM',
          metadata: {
            channel: message.channel,
            from: message.from,
            preview: message.body.substring(0, 100),
            inboundMessageId: message.id,
          },
        },
      });
    });

    this.logger.log(
      `📎 Message appended to existing enquiry ${enquiryId} from ${message.channel}:${message.from}`,
    );
  }

  /**
   * Create a new enquiry for a contact.
   * This happens when the contact has no open enquiries.
   */
  private async createNewEnquiry(
    contactId: string,
    message: { id: string; channel: MessageChannel; from: string; to: string | null; subject: string | null; body: string; externalId: string | null },
    intent?: EnquiryIntent,
    urgency?: number,
    priority?: number,
    extractedData?: any,
  ): Promise<void> {
    // Calculate SLA deadlines
    const slaConfig = await this.prisma.slaConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const slaFirstResponseDue = slaConfig
      ? new Date(now.getTime() + slaConfig.firstResponseMinutes * 60 * 1000)
      : null;
    const slaResolutionDue = slaConfig
      ? new Date(now.getTime() + slaConfig.resolutionHours * 60 * 60 * 1000)
      : null;

    const enquiry = await this.prisma.enquiry.create({
      data: {
        type: EnquiryType.REAL,
        contactId,
        intent: intent as EnquiryIntent,
        urgency,
        priority,
        slaFirstResponseDue,
        slaResolutionDue,
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
            deliveryStatus: 'DELIVERED',
          },
        },
        // Create timeline entry
        timeline: {
          create: {
            type: 'CREATED',
            createdBy: 'SYSTEM',
            metadata: {
              source: 'qualification_pipeline',
              channel: message.channel,
              intent,
              priority,
              inboundMessageId: message.id,
            },
          },
        },
      },
    });

    this.logger.log(
      `🎯 New enquiry ${enquiry.id} created for contact ${contactId} (intent: ${intent})`,
    );

    // Emit for auto-assignment (Part 7)
    this.eventEmitter.emit('enquiry.created', {
      enquiryId: enquiry.id,
      contactId,
      intent,
      priority,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // INBOX — Multi-type inbox with full filtering
  // ═══════════════════════════════════════════════════════════════════

  async getInbox(query: InboxQueryDto, ability: AppAbility, userId?: string) {
    const {
      type, status, intent, assignedToId, assignedToMe,
      search, page = 1, limit = 20, sortBy = 'lastActivityAt', sortOrder = 'desc',
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
          { contact: { displayName: { contains: search, mode: 'insensitive' } } },
          { contact: { organization: { contains: search, mode: 'insensitive' } } },
          { contact: { channels: { some: { identifier: { contains: search } } } } },
          { tags: { hasSome: [search] } },
        ],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * limit;

    const allowedSortFields = [
      'createdAt', 'updatedAt', 'lastActivityAt', 'priority', 'urgency', 'status',
    ];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : 'lastActivityAt';

    const [data, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        include: {
          contact: {
            include: {
              channels: { select: { channel: true, identifier: true, isPrimary: true } },
            },
          },
          assignedTo: {
            select: { id: true, userName: true, displayName: true },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Last message preview
            select: { content: true, channel: true, direction: true, createdAt: true },
          },
          _count: { select: { messages: true, notes: true } },
        },
        orderBy: { [orderField]: sortOrder },
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
  // SINGLE ENQUIRY — Full conversation view
  // ═══════════════════════════════════════════════════════════════════

  async findOne(id: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        contact: {
          include: {
            channels: true,
            // Show all enquiries for this contact (sidebar)
            enquiries: {
              where: { id: { not: id } }, // Exclude current
              select: {
                id: true,
                status: true,
                intent: true,
                createdAt: true,
                _count: { select: { messages: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
        assignedTo: {
          select: { id: true, userName: true, displayName: true },
        },
        // All messages sorted by time (the unified conversation)
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 200,
          include: {
            sentByUser: { select: { id: true, displayName: true } },
          },
        },
        // Internal notes (separate from messages)
        notes: {
          orderBy: { createdAt: 'asc' },
        },
        // Timeline
        timeline: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!enquiry) throw new NotFoundException('Enquiry not found');

    return {
      ...enquiry,
      allowedTransitions: ENQUIRY_TRANSITIONS[enquiry.status],
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CREATE (manual by staff)
  // ═══════════════════════════════════════════════════════════════════

  async create(dto: CreateEnquiryDto, userId?: string) {
    // Verify contact exists
    const contact = await this.prisma.contact.findUnique({
      where: { id: dto.contactId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const data: any = {
      type: dto.type ?? EnquiryType.REAL,
      contactId: dto.contactId,
      tags: dto.tags ?? [],
      lastActivityAt: new Date(),
      timeline: {
        create: {
          type: 'CREATED',
          createdBy: userId ?? 'SYSTEM',
          metadata: { source: 'manual' },
        },
      },
    };

    // If an initial message is provided, create it
    if (dto.initialMessage) {
      // Find the primary channel for this contact
      const primaryChannel = await this.prisma.contactChannel.findFirst({
        where: { contactId: dto.contactId, isPrimary: true },
      });

      if (primaryChannel) {
        data.messages = {
          create: {
            channel: primaryChannel.channel,
            direction: 'OUTBOUND',
            from: userId ?? 'SYSTEM',
            content: dto.initialMessage,
            deliveryStatus: 'PENDING',
            sentByUserId: userId,
          },
        };
      }
    }

    return this.prisma.enquiry.create({ data });
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
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
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

    let eventType = 'STATUS_CHANGED';
    if (dto.status === 'CONVERTED') eventType = 'CONVERTED';
    if (dto.status === 'CLOSED_LOST') eventType = 'CLOSED';
    if (dto.status === 'OPEN' && enquiry.status === 'CLOSED_LOST') eventType = 'REOPENED';

    return this.prisma.enquiry.update({
      where: { id },
      data: {
        status: dto.status,
        version: { increment: 1 },
        lastActivityAt: new Date(),
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

  async assign(enquiryId: string, userId: string, version: number, assignedBy?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    if (enquiry.version !== version) {
      throw new ConflictException(`Version conflict`);
    }

    const eventType = enquiry.assignedToId ? 'REASSIGNED' : 'ASSIGNED';

    // If status is NEW, move to OPEN on assignment
    const statusUpdate = enquiry.status === EnquiryStatus.NEW
      ? { status: EnquiryStatus.OPEN }
      : {};

    return this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        assignedToId: userId,
        version: { increment: 1 },
        lastActivityAt: new Date(),
        ...statusUpdate,
        timeline: {
          create: {
            type: eventType,
            createdBy: assignedBy ?? 'SYSTEM',
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
  // SEND MESSAGE (outbound — staff replies)
  // ═══════════════════════════════════════════════════════════════════

  async sendMessage(
    enquiryId: string,
    dto: SendMessageDto,
    actor: { userId: string; role: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({
        where: { id: enquiryId },
        include: {
          contact: { include: { channels: true } },
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { channel: true },
          },
        },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found');

      if (!canSendMessage(actor, enquiry)) {
        throw new ForbiddenException('Not allowed to send messages for this enquiry');
      }

      // Determine which channel to send on
      let sendChannel: MessageChannel;
      if (dto.channel) {
        sendChannel = dto.channel as MessageChannel;
      } else if (enquiry.messages[0]) {
        // Default: last channel customer used
        sendChannel = enquiry.messages[0].channel;
      } else {
        // Fallback: primary channel
        const primary = enquiry.contact.channels.find((c) => c.isPrimary);
        sendChannel = primary?.channel ?? MessageChannel.EMAIL;
      }

      // Find the recipient identifier for this channel
      const recipientChannel = enquiry.contact.channels.find(
        (c) => c.channel === sendChannel,
      );

      // Resolve template content if using canned response
      let content = dto.content;
      if (dto.templateId) {
        const template = await tx.cannedResponse.findUnique({
          where: { id: dto.templateId },
        });
        if (template) {
          content = this.resolveTemplateVariables(template.content, {
            name: enquiry.contact.displayName,
          });
          // Increment usage count
          await tx.cannedResponse.update({
            where: { id: dto.templateId },
            data: { usageCount: { increment: 1 } },
          });
        }
      }

      // Create the outbound message
      const message = await tx.conversationMessage.create({
        data: {
          enquiryId,
          direction: 'OUTBOUND',
          channel: sendChannel,
          from: actor.userId,
          to: recipientChannel?.identifier,
          content,
          sentByUserId: actor.userId,
          templateId: dto.templateId,
          deliveryStatus: 'PENDING', // Will be updated by outbound pipeline
        },
      });

      // Update enquiry tracking
      const updateData: any = {
        lastActivityAt: new Date(),
        status: EnquiryStatus.AWAITING_CUSTOMER, // Staff replied → waiting for customer
      };

      if (!enquiry.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }

      await tx.enquiry.update({
        where: { id: enquiryId },
        data: updateData,
      });

      // Timeline
      await tx.enquiryTimeline.create({
        data: {
          enquiryId,
          type: 'MESSAGE_SENT',
          createdBy: actor.userId,
          metadata: {
            messageId: message.id,
            channel: sendChannel,
            preview: content.substring(0, 100),
          },
        },
      });

      // Emit event for outbound pipeline (Part 6) to actually send
      this.eventEmitter.emit('message.outbound', {
        messageId: message.id,
        enquiryId,
        channel: sendChannel,
        to: recipientChannel?.identifier,
        content,
        subject: undefined, // Could be set for email
      });

      return message;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL NOTES (private, not sent to customer)
  // ═══════════════════════════════════════════════════════════════════

  async addNote(enquiryId: string, dto: AddNoteDto, userId: string) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    const [note] = await this.prisma.$transaction([
      this.prisma.internalNote.create({
        data: {
          enquiryId,
          content: dto.content,
          createdBy: userId,
        },
      }),
      this.prisma.enquiryTimeline.create({
        data: {
          enquiryId,
          type: 'NOTE_ADDED',
          createdBy: userId,
          metadata: { preview: dto.content.substring(0, 100) },
        },
      }),
      this.prisma.enquiry.update({
        where: { id: enquiryId },
        data: { lastActivityAt: new Date() },
      }),
    ]);

    return note;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════════════

  async updateTags(enquiryId: string, tags: string[], userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    const addedTags = tags.filter((t) => !enquiry.tags.includes(t));
    const removedTags = enquiry.tags.filter((t) => !tags.includes(t));

    const timelineEntries = [
      ...addedTags.map((tag) => ({
        enquiryId,
        type: 'TAG_ADDED' as const,
        createdBy: userId,
        metadata: { tag },
      })),
      ...removedTags.map((tag) => ({
        enquiryId,
        type: 'TAG_REMOVED' as const,
        createdBy: userId,
        metadata: { tag },
      })),
    ];

    return this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        tags,
        lastActivityAt: new Date(),
        timeline: timelineEntries.length > 0
          ? { createMany: { data: timelineEntries } }
          : undefined,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONVERSATION MESSAGES (read)
  // ═══════════════════════════════════════════════════════════════════

  async getMessages(enquiryId: string, page = 1, limit = 50) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    return this.prisma.conversationMessage.findMany({
      where: { enquiryId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sentByUser: { select: { id: true, displayName: true } },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD STATS
  // ═══════════════════════════════════════════════════════════════════

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalEnquiries, newToday, unassigned, pendingFollowUps,
      convertedLast30, totalLast30, statusCounts, intentCounts,
      slaBreached,
    ] = await Promise.all([
      this.prisma.enquiry.count(),
      this.prisma.enquiry.count({ where: { createdAt: { gte: today } } }),
      this.prisma.enquiry.count({ where: { assignedToId: null, status: { notIn: ['CONVERTED', 'CLOSED_LOST'] } } }),
      this.prisma.enquiry.count({ where: { status: 'FOLLOW_UP' } }),
      this.prisma.enquiry.count({ where: { status: 'CONVERTED', updatedAt: { gte: thirtyDaysAgo } } }),
      this.prisma.enquiry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.enquiry.groupBy({ by: ['status'], _count: true }),
      this.prisma.enquiry.groupBy({ by: ['intent'], where: { intent: { not: null } }, _count: true }),
      this.prisma.enquiry.count({ where: { slaBreachedAt: { not: null } } }),
    ]);

    return {
      totalEnquiries, newToday, unassigned, pendingFollowUps,
      conversionRate: totalLast30 > 0 ? Math.round((convertedLast30 / totalLast30) * 100) : 0,
      slaBreached,
      statusBreakdown: statusCounts.reduce((acc, i) => ({ ...acc, [i.status]: i._count }), {}),
      intentBreakdown: intentCounts.reduce((acc, i) => ({ ...acc, [i.intent ?? 'UNKNOWN']: i._count }), {}),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CANNED RESPONSES
  // ═══════════════════════════════════════════════════════════════════

  async getCannedResponses(category?: string) {
    return this.prisma.cannedResponse.findMany({
      where: {
        isActive: true,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private resolveTemplateVariables(
    template: string,
    data: Record<string, string | undefined>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      if (value) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
    }
    return result;
  }
}
```

---

## `src/modules/enquiry/enquiry.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Param, Body, Query, Req,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import {
  CreateEnquiryDto, ChangeStatusDto, AssignEnquiryDto, SendMessageDto, AddNoteDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import type { Request } from 'express';

@Controller('enquiry')
@UseGuards(CaslGuard)
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) {}

  @Get()
  @CheckAbility({ action: 'read', subject: 'Enquiry' })
  getInbox(@Query() query: InboxQueryDto, @Req() req: Request) {
    return this.enquiryService.getInbox(query, req.ability, req.user?.userId);
  }

  @Get('stats')
  @CheckAbility({ action: 'read', subject: 'Dashboard' })
  getStats() { return this.enquiryService.getStats(); }

  @Get('canned-responses')
  @CheckAbility({ action: 'read', subject: 'CannedResponse' })
  getCannedResponses(@Query('category') category?: string) {
    return this.enquiryService.getCannedResponses(category);
  }

  @Get(':id')
  @CheckAbility({ action: 'read', subject: 'Enquiry' })
  findOne(@Param('id') id: string) { return this.enquiryService.findOne(id); }

  @Post()
  @CheckAbility({ action: 'create', subject: 'Enquiry' })
  create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
    return this.enquiryService.create(dto, req.user?.userId);
  }

  @Patch(':id/status')
  @CheckAbility({ action: 'update', subject: 'Enquiry' })
  statusChange(
    @Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request,
  ) {
    return this.enquiryService.statusChange(id, dto, req.ability, req.user?.userId);
  }

  @Patch(':id/assign')
  @CheckAbility({ action: 'assign', subject: 'Enquiry' })
  assign(@Param('id') id: string, @Body() dto: AssignEnquiryDto, @Req() req: Request) {
    return this.enquiryService.assign(id, dto.userId, dto.version, req.user?.userId);
  }

  @Post(':id/messages')
  @CheckAbility({ action: 'create', subject: 'Message' })
  sendMessage(
    @Param('id') id: string, @Body() dto: SendMessageDto, @Req() req: Request,
  ) {
    return this.enquiryService.sendMessage(id, dto, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
  }

  @Get(':id/messages')
  @CheckAbility({ action: 'read', subject: 'Message' })
  getMessages(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.enquiryService.getMessages(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Patch(':id/tags')
  @CheckAbility({ action: 'update', subject: 'Enquiry' })
  updateTags(
    @Param('id') id: string, @Body() body: { tags: string[] }, @Req() req: Request,
  ) {
    return this.enquiryService.updateTags(id, body.tags, req.user?.userId);
  }

  @Post(':id/notes')
  @CheckAbility({ action: 'create', subject: 'InternalNote' })
  addNote(
    @Param('id') id: string, @Body() dto: AddNoteDto, @Req() req: Request,
  ) {
    return this.enquiryService.addNote(id, dto, req.user!.userId);
  }
}
```

---

## `src/modules/enquiry/enquiry.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [ContactModule],
  controllers: [EnquiryController],
  providers: [EnquiryService],
  exports: [EnquiryService],
})
export class EnquiryModule {}
```

---

**Continue to [Part 6: Outbound Pipeline →](./PART6_OUTBOUND_PIPELINE.md)**
