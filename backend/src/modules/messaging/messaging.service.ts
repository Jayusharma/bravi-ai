import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
/**
 * READ-ONLY service for the chat view.
 *
 * WHY NOT USE ContactService or EnquiryService:
 *   ContactService.findAll() returns contacts for a CRM table view.
 *   EnquiryService.findAll() returns enquiries for an inbox.
 *   
 *   The CHAT VIEW needs a DIFFERENT shape:
 *     - Contacts sorted by LAST MESSAGE TIME (not lastSeenAt)
 *     - Each contact shows a message PREVIEW (last message text, truncated)
 *     - Each contact shows the CHANNEL ICON (WhatsApp/Email)
 *     - Each contact shows the ENQUIRY STATUS badge
 *
 *   Building this as a separate service keeps things clean.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  constructor(private prisma: PrismaService) { }
  // ═══════════════════════════════════════════════════════════════
  // LIST CONVERSATIONS
  //
  // Returns contacts that have at least one enquiry with messages,
  // sorted by the most recent message timestamp.
  //
  // Shape of each item (what the frontend sidebar needs):
  //   {
  //     contactId, contactName,
  //     channel, identifier,          ← WhatsApp / +919876543210
  //     enquiryId, enquiryStatus,     ← which enquiry + its state
  //     lastMessage: { content, direction, createdAt },
  //     messageCount,
  //   }
  // ═══════════════════════════════════════════════════════════════
  async listConversations(query?: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query?.page || 1;
    const limit = query?.limit || 30;
    const skip = (page - 1) * limit;
    // Build WHERE — only contacts that have messages
    const where: any = {
      enquiries: {
        some: {
          messages: { some: {} },
        },
      },
    };
    // Search by name or phone number
    if (query?.search) {
      where.OR = [
        { displayName: { contains: query.search, mode: 'insensitive' } },
        {
          channels: {
            some: {
              identifier: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }
    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: {
          // Get primary channel (for sidebar icon)
          channels: {
            select: { channel: true, identifier: true, isPrimary: true },
            orderBy: { isPrimary: 'desc' },
            take: 1,
          },
          // Get latest NON-CLOSED enquiry
          enquiries: {
            where: {
              status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
              messages: { some: {} },
            },
            orderBy: { lastActivityAt: 'desc' },
            take: 1,
            include: {
              // Latest message for preview
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  content: true,
                  direction: true,
                  channel: true,
                  createdAt: true,
                },
              },
              _count: { select: { messages: true } },
              assignedTo: {
                select: { id: true, displayName: true, userName: true },
              },
            },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);
    // Flatten into the shape the frontend needs
    const conversations = contacts
      .map((contact) => {
        const enquiry = contact.enquiries[0];
        if (!enquiry) return null;
        const lastMsg = enquiry.messages[0];
        const channel = contact.channels[0];
        return {
          contactId: contact.id,
          contactName: contact.displayName,
          organization: contact.organization,
          // Channel info
          channel: channel?.channel || null,
          identifier: channel?.identifier || null,
          // Active enquiry
          enquiryId: enquiry.id,
          enquiryStatus: enquiry.status,
          assignedTo: enquiry.assignedTo,
          messageCount: enquiry._count.messages,
          // Last message preview
          lastMessage: lastMsg
            ? {
              content: lastMsg.content.length > 80
                ? lastMsg.content.substring(0, 80) + '…'
                : lastMsg.content,
              direction: lastMsg.direction,
              channel: lastMsg.channel,
              createdAt: lastMsg.createdAt,
            }
            : null,
          lastActivityAt: enquiry.lastActivityAt,
        };
      })
      .filter(Boolean); // Remove contacts with no valid enquiry
    // Sort by last message time (most recent first)
    conversations.sort((a: any, b: any) => {
      const timeA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const timeB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    return {
      data: conversations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // GET THREAD — All enquiries for a contact, each with all messages
  //
  // WHY this shape:
  //   A contact can have multiple enquiries over time (e.g., they
  //   messaged you in Jan about copper wire, then again in March
  //   about delivery). Each enquiry = one conversation thread.
  //
  // Response shape:
  //   {
  //     contact: { id, displayName, channels },
  //     enquiries: [
  //       {
  //         enquiryId, status, createdAt,
  //         messages: [ { id, content, direction, channel, from, createdAt, sentByUser } ]
  //       },
  //       ...
  //     ]
  //   }
  // ═══════════════════════════════════════════════════════════════

  async getThread(contactId: string) {
    // 1. Load the contact + all channels
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        channels: {
          select: { channel: true, identifier: true, isPrimary: true },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact "${contactId}" not found`);
    }

    // 2. Load all enquiries for this contact that have at least 1 message
    //    Each enquiry includes its full message list (oldest first)
    const enquiries = await this.prisma.enquiry.findMany({
      where: {
        contactId,
        messages: { some: {} }, // only enquiries that have messages
      },
      orderBy: { createdAt: 'desc' }, // newest enquiry first
      include: {
        assignedTo: {
          select: { id: true, displayName: true, userName: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' }, // oldest message first (WhatsApp order)
          select: {
            id: true,
            content: true,
            direction: true,
            channel: true,
            from: true,
            to: true,
            subject: true,
            deliveryStatus: true,
            createdAt: true,
            sentByUser: {
              select: { id: true, displayName: true, userName: true },
            },
          },
        },
        _count: { select: { messages: true } },
      },
    });

    // 3. Return clean grouped shape
    return {
      contact: {
        id: contact.id,
        displayName: contact.displayName,
        organization: contact.organization,
        channels: contact.channels,
      },
      enquiries: enquiries.map((enq) => ({
        enquiryId: enq.id,
        status: enq.status,
        type: enq.type,
        intent: enq.intent,
        tags: enq.tags,
        assignedTo: enq.assignedTo,
        messageCount: enq._count.messages,
        createdAt: enq.createdAt,
        lastActivityAt: enq.lastActivityAt,
        messages: enq.messages,
      })),
    };
  }

}
