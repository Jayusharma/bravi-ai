import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MessageChannel } from '@prisma/client';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private prisma: PrismaService) { }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVE — Find or create a contact by channel+identifier (used by ingestion)
  // ═══════════════════════════════════════════════════════════════════════════

  async resolve(
    channel: MessageChannel,
    identifier: string,
    displayName?: string,
  ): Promise<{ contactId: string; isNew: boolean }> {
    const existing = await this.prisma.contactChannel.findUnique({
      where: {
        channel_identifier: { channel, identifier },
      },
      include: { contact: true },
    });

    if (existing) {
      await this.prisma.contact.update({
        where: { id: existing.contactId },
        data: { lastSeenAt: new Date() },
      });

      this.logger.debug(
        `👤 Resolved existing contact: ${existing.contact.displayName} (${existing.contactId})`,
      );

      return { contactId: existing.contactId, isNew: false };
    }

    const contact = await this.prisma.contact.create({
      data: {
        displayName: displayName || identifier,
        channels: {
          create: { channel, identifier },
        },
      },
    });

    this.logger.debug(
      `🆕 Created new contact: ${contact.displayName} (${contact.id})`,
    );

    return { contactId: contact.id, isNew: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND ALL — List contacts with channels, enquiry count, search & pagination
  // ═══════════════════════════════════════════════════════════════════════════

  async findAll(query?: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    // Build where clause for search
    const where = query?.search
      ? {
        OR: [
          { displayName: { contains: query.search, mode: 'insensitive' as const } },
          { organization: { contains: query.search, mode: 'insensitive' as const } },
          {
            channels: {
              some: {
                identifier: { contains: query.search, mode: 'insensitive' as const },
              },
            },
          },
        ],
      }
      : {};

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: {
          channels: {
            select: {
              id: true,
              channel: true,
              identifier: true,
              isPrimary: true,
              isVerified: true,
            },
            orderBy: { isPrimary: 'desc' },
          },
          _count: {
            select: {
              enquiries: true,
              inboundMessages: true,
            },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      data: contacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND BY ID — Single contact with full details
  // ═══════════════════════════════════════════════════════════════════════════

  async findById(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        channels: {
          select: {
            id: true,
            channel: true,
            identifier: true,
            isPrimary: true,
            isVerified: true,
            createdAt: true,
          },
          orderBy: { isPrimary: 'desc' },
        },
        _count: {
          select: {
            enquiries: true,
            inboundMessages: true,
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${id}" not found`);
    }

    return contact;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE — Edit contact profile (displayName, organization, notes)
  // ═══════════════════════════════════════════════════════════════════════════

  async updateContact(id: string, dto: UpdateContactDto) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${id}" not found`);
    }

    return this.prisma.contact.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.organization !== undefined && { organization: dto.organization }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        channels: {
          select: {
            id: true,
            channel: true,
            identifier: true,
            isPrimary: true,
          },
        },
      },
    });
  }
}