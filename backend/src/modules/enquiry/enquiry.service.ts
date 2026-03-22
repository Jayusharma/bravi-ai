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
import {
  CreateEnquiryDto,
  ChangeStatusDto,
  SendMessageDto,
  AddNoteDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
import {
  EnquiryStatus,
  EnquiryType,
  EnquiryIntent,
  Enquiry,
  MessageChannel,
  Prisma,
} from '@prisma/client';
import { AppAbility } from '../casl/casl.types';
import { accessibleBy } from '@casl/prisma';
import { AuthUser } from 'src/common/types/auth-user.interface';

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) { }

  // ═══════════════════════════════════════════════════════════════════
  // INBOX — Paginated list with filters
  // ═══════════════════════════════════════════════════════════════════

  async findAll(query: InboxQueryDto, ability?: AppAbility) {
    const {
      status,
      type,
      assignedToId,
      search,
      source,
      page = 1,
      limit = 20,
      sortBy = 'lastActivityAt',
      sortOrder = 'desc',
    } = query;

    // Build the where clause
    const where: Prisma.EnquiryWhereInput = {};

    // CASL authorization filter
    if (ability) {
      try {
        where.AND = [accessibleBy(ability).Enquiry];
      } catch {
        // If CASL can't build filter, user has no access
        return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    if (status) where.status = status;
    if (type) where.type = type;
    if (assignedToId) where.assignedToId = assignedToId;

    // Search across contact's name, channels (phone/email), and tags
    if (search) {
      where.OR = [
        { contact: { displayName: { contains: search, mode: 'insensitive' } } },
        { contact: { channels: { some: { identifier: { contains: search, mode: 'insensitive' } } } } },
        { tags: { has: search } },
      ];
    }

    // Source filter: look for messages from a specific channel
    if (source) {
      where.messages = {
        some: { channel: source as MessageChannel },
      };
    }

    // Allowed sort columns (whitelist for safety)
    const allowedSorts = ['createdAt', 'updatedAt', 'lastActivityAt', 'priority', 'urgency'];
    const orderField = allowedSorts.includes(sortBy) ? sortBy : 'lastActivityAt';

    const [items, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        include: {
          contact: {
            include: {
              channels: true,
            },
          },
          assignedTo: {
            select: { id: true, displayName: true, userName: true },
          },
          _count: { select: { messages: true, notes: true } },
        },
        orderBy: { [orderField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    // Flatten for the frontend: extract name/email/phone from contact
    const flatItems = items.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      tags: e.tags,
      intent: e.intent,
      urgency: e.urgency,
      priority: e.priority,
      version: e.version,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastActivityAt: e.lastActivityAt,
      lastCustomerReplyAt: e.lastCustomerReplyAt,
      // Flatten contact info
      contactId: e.contactId,
      name: e.contact?.displayName || 'Unknown',
      email: e.contact?.channels?.find((c) => c.channel === 'EMAIL')?.identifier || null,
      phone: e.contact?.channels?.find((c) => c.channel === 'WHATSAPP')?.identifier
        || e.contact?.channels?.find((c) => c.channel === 'SMS')?.identifier
        || null,
      source: e.contact?.channels?.[0]?.channel || 'MANUAL',
      // Assignment
      assignedTo: e.assignedTo,
      // Counts
      messageCount: e._count.messages,
      noteCount: e._count.notes,
    }));

    return {
      items: flatItems,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }


  async getEnquiriesByContact(contactId: string) {
    // Verify contact exists
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact "${contactId}" not found`);
    }

    const enquiries = await this.prisma.enquiry.findMany({
      where: { contactId },
      include: {
        assignedTo: {
          select: { id: true, displayName: true, userName: true },
        },
        _count: { select: { messages: true, notes: true } },
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    return {
      contactId,
      contactName: contact.displayName,
      totalEnquiries: enquiries.length,
      enquiries: enquiries.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        tags: e.tags,
        intent: e.intent,
        urgency: e.urgency,
        priority: e.priority,
        assignedTo: e.assignedTo,
        messageCount: e._count.messages,
        noteCount: e._count.notes,
        lastActivityAt: e.lastActivityAt,
        createdAt: e.createdAt,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL — Single enquiry with all relations
  // ═══════════════════════════════════════════════════════════════════

  async findOne(id: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        contact: {
          include: { channels: true },
        },
        assignedTo: {
          select: { id: true, displayName: true, userName: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sentByUser: {
              select: { id: true, displayName: true, userName: true },
            },
          },
        },
        timeline: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        notes: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!enquiry) {
      throw new NotFoundException(`Enquiry ${id} not found`);
    }

    return enquiry;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CREATE — Manual enquiry creation by staff
  // ═══════════════════════════════════════════════════════════════════

  async create(dto: CreateEnquiryDto, userId?: string) {
    // Verify contact exists
    const contact = await this.prisma.contact.findUnique({
      where: { id: dto.contactId },
    });
    if (!contact) {
      throw new BadRequestException(`Contact ${dto.contactId} not found`);
    }

    // Check for existing open enquiry for this contact
    const existing = await this.prisma.enquiry.findFirst({
      where: {
        contactId: dto.contactId,
        status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Contact already has an open enquiry (${existing.id}). Close it first or append messages to it.`,
      );
    }

    const enquiry = await this.prisma.enquiry.create({
      data: {
        contactId: dto.contactId,
        type: dto.type || EnquiryType.REAL,
        status: EnquiryStatus.NEW,
        tags: dto.tags || [],
        // If an initial message is provided, create it
        ...(dto.initialMessage
          ? {
            messages: {
              create: {
                channel: MessageChannel.EMAIL, // Default for manual
                direction: 'OUTBOUND',
                from: userId || 'SYSTEM',
                content: dto.initialMessage,
                sentByUserId: userId,
              },
            },
          }
          : {}),
        // Timeline entry
        timeline: {
          create: {
            type: 'CREATED',
            toStatus: EnquiryStatus.NEW,
            createdBy: userId || 'SYSTEM',
            metadata: { source: 'MANUAL' },
          },
        },
      },
      include: {
        contact: { include: { channels: true } },
        messages: true,
      },
    });

    this.logger.log(`✅ Manual enquiry created: ${enquiry.id} by ${userId}`);
    return enquiry;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATUS CHANGE — FSM-validated transitions
  // ═══════════════════════════════════════════════════════════════════

  async statusChange(
    id: string,
    dto: ChangeStatusDto,
    ability?: AppAbility,
    userId?: string,
  ) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });

    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    // Optimistic concurrency check
    if (dto.version !== enquiry.version) {
      throw new ConflictException(
        `Enquiry was modified by someone else. Expected version ${dto.version}, current is ${enquiry.version}. Please refresh and try again.`,
      );
    }

    // Validate FSM transition
    const allowed = ENQUIRY_TRANSITIONS[enquiry.status];
    if (!allowed?.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${enquiry.status} to ${dto.status}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    const updated = await this.prisma.enquiry.update({
      where: { id },
      data: {
        status: dto.status,
        version: { increment: 1 },
        lastActivityAt: new Date(),
        ...(dto.status === 'CLOSED_LOST' && dto.lostReason
          ? { lostReason: dto.lostReason }
          : {}),
        timeline: {
          create: {
            type: 'STATUS_CHANGED',
            fromStatus: enquiry.status,
            toStatus: dto.status,
            createdBy: userId || 'SYSTEM',
            metadata: dto.lostReason ? { lostReason: dto.lostReason } : undefined,
          },
        },
      },
      include: {
        contact: { include: { channels: true } },
        assignedTo: { select: { id: true, displayName: true, userName: true } },
      },
    });

    this.logger.log(`📋 Enquiry ${id}: ${enquiry.status} → ${dto.status}`);
    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSIGN — Assign enquiry to a team member
  // ═══════════════════════════════════════════════════════════════════

  async assign(id: string, userId: string, version: number) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });

    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    if (version !== enquiry.version) {
      throw new ConflictException(
        `Enquiry was modified. Expected version ${version}, current is ${enquiry.version}.`,
      );
    }

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new BadRequestException(`User ${userId} not found`);

    const previousAssignee = enquiry.assignedToId;

    const updated = await this.prisma.enquiry.update({
      where: { id },
      data: {
        assignedToId: userId,
        version: { increment: 1 },
        lastActivityAt: new Date(),
        // Auto-open on assignment if NEW
        ...(enquiry.status === 'NEW' ? { status: EnquiryStatus.OPEN } : {}),
        timeline: {
          create: {
            type: previousAssignee ? 'REASSIGNED' : 'ASSIGNED',
            createdBy: 'SYSTEM',
            metadata: {
              assignedTo: userId,
              assigneeName: user.displayName || user.userName,
              previousAssignee,
            },
          },
        },
      },
      include: {
        assignedTo: { select: { id: true, displayName: true, userName: true } },
      },
    });

    this.logger.log(`👤 Enquiry ${id} assigned to ${user.displayName || user.userName}`);
    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAGS — Add/remove tags
  // ═══════════════════════════════════════════════════════════════════

  async updateTags(id: string, tags: string[], userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });
    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    const oldTags = enquiry.tags || [];
    const addedTags = tags.filter((t) => !oldTags.includes(t));
    const removedTags = oldTags.filter((t) => !tags.includes(t));

    // Create timeline events for tag changes
    const timelineEntries: any[] = [];
    addedTags.forEach((tag) => {
      timelineEntries.push({
        type: 'TAG_ADDED',
        createdBy: userId || 'SYSTEM',
        metadata: { tag },
      });
    });
    removedTags.forEach((tag) => {
      timelineEntries.push({
        type: 'TAG_REMOVED',
        createdBy: userId || 'SYSTEM',
        metadata: { tag },
      });
    });

    const updated = await this.prisma.enquiry.update({
      where: { id },
      data: {
        tags,
        lastActivityAt: new Date(),
        ...(timelineEntries.length > 0
          ? { timeline: { createMany: { data: timelineEntries } } }
          : {}),
      },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SEND MESSAGE — Reply to customer (emits outbound event)
  // ═══════════════════════════════════════════════════════════════════

  async sendMessage(
    id: string,
    dto: SendMessageDto,
    actor: { userId: string; role: string },
  ) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        contact: { include: { channels: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    // Determine channel: explicit > last customer message > first contact channel
    const channel =
      (dto.channel as MessageChannel) ||
      enquiry.messages?.[0]?.channel ||
      enquiry.contact?.channels?.[0]?.channel ||
      MessageChannel.WHATSAPP;

    // Get recipient from contact channels
    const recipientChannel = enquiry.contact?.channels?.find(
      (c) => c.channel === channel,
    );
    const to = recipientChannel?.identifier;

    if (!to) {
      throw new BadRequestException(
        `Contact has no ${channel} channel. Available: ${enquiry.contact?.channels?.map((c) => c.channel).join(', ')}`,
      );
    }

    // Create the outbound message
    const message = await this.prisma.conversationMessage.create({
      data: {
        enquiryId: id,
        channel,
        direction: 'OUTBOUND',
        from: actor.userId,
        to,
        content: dto.content,
        sentByUserId: actor.userId,
        deliveryStatus: 'PENDING',
      },
    });

    // Update enquiry state
    await this.prisma.enquiry.update({
      where: { id },
      data: {
        lastActivityAt: new Date(),
        ...(enquiry.firstResponseAt === null
          ? { firstResponseAt: new Date() }
          : {}),
        // Auto-transition to AWAITING_CUSTOMER if currently IN_PROGRESS
        ...(enquiry.status === 'IN_PROGRESS'
          ? { status: EnquiryStatus.AWAITING_CUSTOMER }
          : {}),
        timeline: {
          create: {
            type: 'MESSAGE_SENT',
            createdBy: actor.userId,
            metadata: { channel, messageId: message.id },
          },
        },
      },
    });

    // Emit outbound event for the OutboundModule to pick up
    this.eventEmitter.emit('message.outbound', {
      messageId: message.id,
      enquiryId: id,
      channel,
      to,
      content: dto.content,
    });

    this.logger.log(`📤 Message queued for ${channel} → ${to}`);
    return message;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET MESSAGES — List conversation messages
  // ═══════════════════════════════════════════════════════════════════

  async getMessages(id: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });
    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    return this.prisma.conversationMessage.findMany({
      where: { enquiryId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        sentByUser: {
          select: { id: true, displayName: true, userName: true },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADD NOTE — Internal note (not sent to customer)
  // ═══════════════════════════════════════════════════════════════════

  async addNote(id: string, dto: AddNoteDto, userId: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });
    if (!enquiry) throw new NotFoundException(`Enquiry ${id} not found`);

    const note = await this.prisma.internalNote.create({
      data: {
        enquiryId: id,
        content: dto.content,
        createdBy: userId,
      },
    });

    // Timeline entry
    await this.prisma.enquiryTimeline.create({
      data: {
        enquiryId: id,
        type: 'NOTE_ADDED',
        createdBy: userId,
        metadata: { noteId: note.id },
      },
    });

    // Update last activity
    await this.prisma.enquiry.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });

    return note;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS — Dashboard KPIs
  // ═══════════════════════════════════════════════════════════════════

  async getStats() {
    const [statusCounts, totalToday, unassigned] = await Promise.all([
      this.prisma.enquiry.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.enquiry.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.enquiry.count({
        where: {
          assignedToId: null,
          status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
        },
      }),
    ]);

    // Transform groupBy into a clean object
    const byStatus: Record<string, number> = {};
    statusCounts.forEach((row) => {
      byStatus[row.status] = row._count.id;
    });

    return {
      byStatus,
      totalToday,
      unassigned,
      totalOpen:
        (byStatus.NEW || 0) +
        (byStatus.OPEN || 0) +
        (byStatus.IN_PROGRESS || 0) +
        (byStatus.AWAITING_CUSTOMER || 0) +
        (byStatus.QUOTATION_SENT || 0) +
        (byStatus.FOLLOW_UP || 0),
    };
  }

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
    contactId: string;
    intent?: string;
    urgency?: number;
    priority?: number;
    extractedData?: any;
  }) {
    const { inboundMessageId, contactId, intent, urgency, priority, extractedData } = payload;
    if (!contactId) {
      this.logger.error(`No contactId for message ${inboundMessageId} — cannot create enquiry`);
      return;
    }

    // Load the inbound message to get the actual content
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });
    console.log('message ', message);

    if (!message) {
      this.logger.error(`InboundMessage ${inboundMessageId} not found`);
      return;
    }

    // Race condition guard: check again in case another message
    // from the same contact already created an enquiry
    const openEnquiry = await this.prisma.enquiry.findFirst({
      where: {
        contactId: payload.contactId,
        status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
      },
    });
    if (openEnquiry) {
      // Race condition: another message already created the enquiry
      // Just append this message
      await this.prisma.conversationMessage.create({
        data: {
          enquiryId: openEnquiry.id,
          channel: message.channel,
          direction: 'INBOUND',
          from: message.from,
          content: message.body,
        },
      });
      return;
    }
    // Normal case: create new enquiry
    await this.prisma.enquiry.create({
      data: {
        contactId: payload.contactId,
        type: 'REAL',
        status: 'NEW',
        urgency: payload.urgency,
        priority: payload.priority,
        messages: {
          create: {
            channel: message.channel,
            direction: 'INBOUND',
            from: message.from,
            content: message.body,
          },
        },
      },
    });
  }
}