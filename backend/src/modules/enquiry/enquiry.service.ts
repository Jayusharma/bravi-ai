import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateEnquiryDto, ChangeStatusDto, SendMessageDto } from './dto/create-enquiry.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
import { EnquirySource, EnquiryStatus } from '@prisma/client';
import { automationQueue } from '../automation/automation.queue';
import { canSendMessage } from './policy/enquiry.policy';
import { randomUUID } from 'crypto';

/**
 * EnquiryService — core business logic for the enquiry lifecycle.
 */
@Injectable()
export class EnquiryService {
  constructor(private prisma: PrismaService) { }

  // ─── List with Filtering, Search, Pagination ──────────────────────

  async findAll(filters: {
    status?: string;
    source?: string;
    assignedToId?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const { status, source, assignedToId, search, page, limit } = filters;

    const where: any = {};

    if (status) {
      where.status = status as EnquiryStatus;
    }
    if (source) {
      where.source = source as EnquirySource;
    }
    if (assignedToId) {
      where.assignedToId = assignedToId;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        include: {
          assignedTo: {
            select: { id: true, userName: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    return {
      items: data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────

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
    ]);

    const conversionRate = totalLast30 > 0
      ? Math.round((convertedLast30 / totalLast30) * 100)
      : 0;

    return {
      totalEnquiries,
      newToday,
      unassigned,
      pendingFollowUps,
      conversionRate,
      statusBreakdown: statusCounts.reduce(
        (acc, item) => {
          acc[item.status] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  // ─── Get Single Enquiry with Timeline & Messages ──────────────────

  async findOne(id: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, userName: true, displayName: true },
        },
        timeline: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        message: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    // Get allowed transitions for current state
    const allowedTransitions = ENQUIRY_TRANSITIONS[enquiry.status];

    return {
      ...enquiry,
      allowedTransitions,
    };
  }

  // ─── Create ───────────────────────────────────────────────────────

  async create(dto: CreateEnquiryDto, userId?: string, key?: string) {
    const enquiry = await this.prisma.enquiry.create({
      data: {
        ...dto,
        timeline: {
          create: {
            type: 'CREATED',
            createdBy: userId ?? 'SYSTEM',
          },
        },
      },
    });

    if (key) {
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: {
          status: 'COMPLETED',
          response: enquiry,
        },
      });
    }

    return enquiry;
  }

  // ─── Create from Inbound Message ──────────────────────────────────

  async createFromMessage(param: {
    source: EnquirySource;
    from: string;
  }) {
    return this.prisma.enquiry.create({
      data: {
        source: param.source,
        email: param.source === 'EMAIL' ? param.from : undefined,
        phone: param.source === 'WHATSAPP' ? param.from : undefined,
        timeline: {
          create: {
            type: 'CREATED',
            createdBy: 'SYSTEM',
          },
        },
      },
    });
  }

  // ─── Status Change (FSM Validated) ────────────────────────────────

  async statusChange(id: string, dto: ChangeStatusDto, userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    if (enquiry.version !== dto.version) {
      throw new ConflictException(
        `Enquiry was modified by another user. Your version: ${dto.version}, current version: ${enquiry.version}`,
      );
    }

    const allowedTransitions = ENQUIRY_TRANSITIONS[enquiry.status];

    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${enquiry.status} to ${dto.status}. ` +
        `Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`,
      );
    }

    // ─── Side effects based on target status ──────────────────
    if (dto.status === 'QUOTATION_SENT' || dto.status === 'FOLLOW_UP') {
      // Schedule follow-up automation
      await automationQueue.add(
        'automation',
        { enquiryId: enquiry.id },
        {
          jobId: `followup_${enquiry.id}`,
          delay: dto.status === 'QUOTATION_SENT' ? 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } else if (dto.status === 'CONVERTED' || dto.status === 'CLOSED_LOST') {
      // Terminal states — cancel any pending automation
      await automationQueue.remove(`followup_${enquiry.id}`);
    }

    // Determine timeline event type
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

  // ─── Assign ───────────────────────────────────────────────────────

  async assign(enquiryId: string, userId: string, version: number) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    if (enquiry.version !== version) {
      throw new ConflictException(
        `Enquiry was modified by another user. Your version: ${version}, current version: ${enquiry.version}`,
      );
    }

    // Determine if this is a new assignment or reassignment
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

  // ─── Tags ─────────────────────────────────────────────────────────

  async updateTags(enquiryId: string, tags: string[], userId?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    // Determine added and removed tags for audit
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
        timeline: {
          createMany: timelineEntries.length > 0
            ? { data: timelineEntries.map((e) => ({ ...e, enquiryId })) }
            : undefined,
        },
      },
    });
  }

  // ─── Send Message ─────────────────────────────────────────────────

  async sendMessage(
    enquiryId: string,
    dto: SendMessageDto,
    actor: { userId: string; role: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({
        where: { id: enquiryId },
      });

      if (!enquiry) {
        throw new NotFoundException('Enquiry not found');
      }

      if (!canSendMessage(actor, enquiry)) {
        throw new ForbiddenException(
          'You are not allowed to send messages for this enquiry',
        );
      }

      const message = await tx.message.create({
        data: {
          enquiryId: enquiry.id,
          direction: 'OUTBOUND',
          channel: 'EMAIL', // TODO: support channel selection
          externalId: `outbound-${randomUUID()}`,
          from: actor.userId,
          content: dto.content,
        },
      });

      await tx.enquiryTimeline.create({
        data: {
          enquiryId: enquiry.id,
          type: 'MESSAGE_SENT',
          createdBy: actor.userId,
          metadata: { messageId: message.id, preview: dto.content.substring(0, 100) },
        },
      });

      // Track first response time
      if (!enquiry.firstResponseAt) {
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { firstResponseAt: new Date() },
        });
      }

      return message;
    });
  }

  // ─── Get Messages ─────────────────────────────────────────────────

  async getMessages(enquiryId: string) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    return this.prisma.message.findMany({
      where: { enquiryId },
      orderBy: { createdAt: 'asc' },
    });
  }
}