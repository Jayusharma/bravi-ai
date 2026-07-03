import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MessageChannel, Prisma } from '@prisma/client';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { AddChannelDto } from './dto/add-channel.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private prisma: PrismaService) { }

  // Resolves contact by channel and identifier, creating a new contact if not found
  async resolve(
    channel: MessageChannel,
    identifier: string,
    displayName?: string,
  ): Promise<{ contactId: string; isNew: boolean }> {
    const normalizedIdentifier = this.normalizeIdentifier(channel, identifier);

    const existing = await this.prisma.contactChannel.findUnique({
      where: {
        channel_identifier: { channel, identifier: normalizedIdentifier },
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

    try {
      const contact = await this.prisma.contact.create({
        data: {
          displayName: displayName || normalizedIdentifier,
          channels: {
            create: { channel, identifier: normalizedIdentifier, isPrimary: true },
          },
        },
      });

      this.logger.debug(
        `🆕 Created new contact: ${contact.displayName} (${contact.id})`,
      );

      return { contactId: contact.id, isNew: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.prisma.contactChannel.findUnique({
          where: {
            channel_identifier: { channel, identifier: normalizedIdentifier },
          },
          include: { contact: true },
        });

        if (concurrent) {
          this.logger.debug(
            `👤 Resolved concurrently-created contact: ${concurrent.contact.displayName} (${concurrent.contactId})`,
          );
          return { contactId: concurrent.contactId, isNew: false };
        }
      }

      throw error;
    }
  }

  // Lists all contacts with pagination and search, adding hasActiveEnquiry status
  async findAll(query?: {
    search?: string;
    page?: number;
    limit?: number;
    channel?: string;
    status?: string;
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    const andConditions: Prisma.ContactWhereInput[] = [];

    if (query?.search) {
      andConditions.push({
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
      });
    }

    if (query?.channel && query.channel !== 'ALL') {
      andConditions.push({
        channels: {
          some: {
            channel: query.channel as MessageChannel,
          },
        },
      });
    }

    if (query?.status && query.status !== 'ALL') {
      if (query.status === 'ACTIVE') {
        andConditions.push({
          enquiries: {
            some: {
              status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
            },
          },
        });
      } else if (query.status === 'INACTIVE') {
        andConditions.push({
          enquiries: {
            none: {
              status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
            },
          },
        });
      }
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

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
          enquiries: {
            where: {
              status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
            },
            select: {
              id: true,
            },
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

    const enrichedContacts = contacts.map(({ enquiries, ...c }) => ({
      ...c,
      hasActiveEnquiry: enquiries.length > 0,
    }));

    return {
      data: enrichedContacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Retrieves details of a contact by ID, including channels and active enquiry status
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
        enquiries: {
          where: {
            status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
          },
          select: {
            id: true,
          },
          take: 1,
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

    const { enquiries, ...rest } = contact;

    return {
      ...rest,
      hasActiveEnquiry: enquiries.length > 0,
    };
  }

  // Manually creates a new contact with an initial channel
  async createContact(dto: CreateContactDto) {
    const normalizedIdentifier = this.normalizeIdentifier(dto.channel, dto.identifier);

    const existingChannel = await this.prisma.contactChannel.findUnique({
      where: {
        channel_identifier: { channel: dto.channel, identifier: normalizedIdentifier },
      },
    });

    if (existingChannel) {
      throw new BadRequestException('Channel identifier already registered to another contact');
    }

    return this.prisma.contact.create({
      data: {
        displayName: dto.displayName,
        organization: dto.organization,
        notes: dto.notes,
        channels: {
          create: {
            channel: dto.channel,
            identifier: normalizedIdentifier,
            isPrimary: true,
            isVerified: true,
          },
        },
      },
      include: {
        channels: true,
      },
    });
  }

  // Updates basic details of a contact profile
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

  // Adds a channel to an existing contact
  async addChannel(contactId: string, dto: AddChannelDto) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${contactId}" not found`);
    }

    const normalizedIdentifier = this.normalizeIdentifier(dto.channel, dto.identifier);

    const existingChannel = await this.prisma.contactChannel.findUnique({
      where: {
        channel_identifier: { channel: dto.channel, identifier: normalizedIdentifier },
      },
    });

    if (existingChannel) {
      throw new BadRequestException('Channel identifier already registered to another contact');
    }

    return this.prisma.contactChannel.create({
      data: {
        contactId,
        channel: dto.channel,
        identifier: normalizedIdentifier,
        isPrimary: dto.isPrimary || false,
      },
    });
  }

  // Removes a channel from a contact
  async removeChannel(contactId: string, channelId: string) {
    const channels = await this.prisma.contactChannel.findMany({
      where: { contactId },
    });

    if (channels.length <= 1) {
      throw new BadRequestException('Cannot delete the last remaining channel of a contact');
    }

    const channelToDelete = channels.find(c => c.id === channelId);
    if (!channelToDelete) {
      throw new NotFoundException(`Channel with ID "${channelId}" not found for this contact`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.contactChannel.delete({
        where: { id: channelId },
      });

      if (channelToDelete.isPrimary) {
        const oldestRemaining = channels.filter(c => c.id !== channelId)[0];
        await tx.contactChannel.update({
          where: { id: oldestRemaining.id },
          data: { isPrimary: true },
        });
      }
    });
  }

  // Sets a channel as primary for a contact
  async setPrimaryChannel(contactId: string, channelId: string) {
    const channel = await this.prisma.contactChannel.findFirst({
      where: { id: channelId, contactId },
    });

    if (!channel) {
      throw new NotFoundException(`Channel with ID "${channelId}" not found for this contact`);
    }

    return this.prisma.$transaction([
      this.prisma.contactChannel.updateMany({
        where: { contactId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.contactChannel.update({
        where: { id: channelId },
        data: { isPrimary: true },
      }),
    ]);
  }

  // Deletes a contact, throwing if they have active enquiries
  async deleteContact(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${id}" not found`);
    }

    const activeEnquiriesCount = await this.prisma.enquiry.count({
      where: {
        contactId: id,
        status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
      },
    });

    if (activeEnquiriesCount > 0) {
      throw new BadRequestException('Active enquiry exists for this contact. Close the enquiry before deleting.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.enquiry.deleteMany({
        where: { contactId: id },
      });
      return tx.contact.delete({
        where: { id },
      });
    });
  }

  // Deletes multiple contacts in a bulk operation
  async deleteContacts(ids: string[]) {
    const activeEnquiriesCount = await this.prisma.enquiry.count({
      where: {
        contactId: { in: ids },
        status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
      },
    });

    if (activeEnquiriesCount > 0) {
      throw new BadRequestException('One or more selected contacts have active enquiries. Close the enquiries before deleting.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.enquiry.deleteMany({
        where: { contactId: { in: ids } },
      });
      return tx.contact.deleteMany({
        where: { id: { in: ids } },
      });
    });
  }

  // Normalizes communication identifiers (e.g. lowecasing email addresses)
  private normalizeIdentifier(channel: MessageChannel, identifier: string): string {
    const value = identifier.trim();
    return channel === MessageChannel.EMAIL ? value.toLowerCase() : value;
  }
}
