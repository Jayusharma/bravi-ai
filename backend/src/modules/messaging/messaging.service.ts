import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/database/prisma.service';
import { MessageChannel, MessageDirection } from '@prisma/client';
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
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) { }
  // ═══════════════════════════════════════════════════════════════
  // CONTACT SUMMARY — the single source of truth for a contact's
  // "latest state" (last message preview + read watermark).
  //
  // WHY: Before this existed, broadcastConversationDelta,
  //      broadcastConversationNew, and the gateway's outbound:send
  //      handler each independently computed a "last message" —
  //      every one of them scoped to ONE enquiry instead of the
  //      contact's full message history. This is the replacement:
  //      reads Contact.lastMessageSeq/lastReadSeq directly (no join
  //      needed, they live on Contact now) plus one indexed query
  //      for the preview, ordered by the authoritative `seq`.
  // ═══════════════════════════════════════════════════════════════

  async getContactSummary(contactId: string): Promise<{
    lastMessagePreview: string;
    lastMessageAt: Date | null;
    lastMessageChannel: MessageChannel | null;
    lastMessageDirection: MessageDirection | null;
    lastMessageSeq: number;
    lastReadSeq: number;
  } | null> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { lastMessageSeq: true, lastReadSeq: true },
    });
    if (!contact) return null;

    const latest = await this.prisma.conversationMessage.findFirst({
      where: { contactId },
      orderBy: { seq: 'desc' },
      select: { content: true, channel: true, direction: true, createdAt: true },
    });

    return {
      lastMessagePreview: latest ? latest.content.substring(0, 80) : '',
      lastMessageAt: latest?.createdAt ?? null,
      lastMessageChannel: latest?.channel ?? null,
      lastMessageDirection: latest?.direction ?? null,
      lastMessageSeq: contact.lastMessageSeq,
      lastReadSeq: contact.lastReadSeq,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UNREAD SUMMARY — global nav badge: count of DISTINCT CONTACTS with
  // unread messages, per channel (not message count — 5 unread messages
  // in one chat counts as 1). Contact.lastReadSeq/lastMessageSeq span ALL
  // of a contact's channels combined, so attributing an unread contact to
  // a specific channel needs a join against the actual message rows —
  // the two watermark fields alone can't say which channel the unread
  // message arrived on. Uses the existing @@index([contactId, seq(desc)])
  // on ConversationMessage.
  // ═══════════════════════════════════════════════════════════════

  async getUnreadSummary(): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<{ channel: MessageChannel; count: bigint }[]>`
      SELECT cm.channel, COUNT(DISTINCT cm."contactId") AS count
      FROM "ConversationMessage" cm
      JOIN "Contact" c ON c.id = cm."contactId"
      WHERE cm.seq > c."lastReadSeq"
      GROUP BY cm.channel
    `;
    const summary: Record<string, number> = { EMAIL: 0, WHATSAPP: 0, SMS: 0 };
    for (const row of rows) summary[row.channel] = Number(row.count);
    return summary;
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST CONVERSATIONS
  //
  // Returns contacts that have at least one message, sorted by the
  // most recent message timestamp — aggregated across ALL of a
  // contact's enquiries (open AND closed), not just the latest
  // non-terminal one. A contact whose only enquiries are CONVERTED/
  // CLOSED_LOST still belongs here with its full history — it used
  // to silently disappear from this list because the old query only
  // ever looked at `take: 1` non-terminal enquiry.
  //
  // Message/read data comes from getContactSummary() (single source
  // of truth, see above). The enquiry sub-fetch below is ONLY for
  // card metadata that's genuinely enquiry-level (status badge,
  // assignee) — resolved from the contact's most-recently-active
  // enquiry regardless of status, not filtered to open ones.
  // ═══════════════════════════════════════════════════════════════
  async listConversations(
    query?: {
      search?: string;
      page?: number;
      limit?: number;
      channel?: string;
    },
    userId?: string,
  ) {
    const page = query?.page || 1;
    const limit = query?.limit || 30;
    const skip = (page - 1) * limit;

    const messageFilter = query?.channel
      ? { some: { channel: query.channel as any } }
      : { some: {} };

    // Build WHERE — only contacts that have messages (now a direct relation,
    // no need to join through enquiries to find out if the contact ever messaged)
    const where: any = {
      messages: messageFilter,
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
        select: {
          id: true,
          displayName: true,
          organization: true,
          // Primary channel (for sidebar icon)
          channels: {
            select: { channel: true, identifier: true, isPrimary: true },
            orderBy: { isPrimary: 'desc' },
            take: 1,
          },
          // Most-recently-active enquiry for status badge + assignee — ANY
          // status, not just non-terminal (that was the closed-contact bug).
          enquiries: {
            orderBy: { lastActivityAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
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

    // Message/read summary — single source of truth, one call per contact.
    const summaries = await Promise.all(
      contacts.map((c) => this.getContactSummary(c.id)),
    );

    // Fetch active drafts for all latest-enquiry IDs in one query
    const enquiryIds = contacts
      .map((c) => c.enquiries[0]?.id)
      .filter(Boolean) as string[];

    const activeDrafts = enquiryIds.length > 0
      ? await this.prisma.outboundDraft.findMany({
          where: {
            enquiryId: { in: enquiryIds },
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            ...(userId ? { createdBy: userId } : {}),
          },
          select: {
            enquiryId: true,
            body: true,
            channel: true,
            _count: { select: { attachments: true } },
          },
        })
      : [];

    const draftByEnquiry = new Map(
      activeDrafts.map((d) => [d.enquiryId, d]),
    );

    // Flatten into the shape the frontend needs
    const conversations = contacts
      .map((contact, i) => {
        const summary = summaries[i];
        if (!summary) return null;
        const enquiry = contact.enquiries[0];
        const channel = contact.channels[0];
        const draft = enquiry ? draftByEnquiry.get(enquiry.id) : undefined;
        return {
          contactId: contact.id,
          contactName: contact.displayName,
          organization: contact.organization,
          channel: channel?.channel || null,
          identifier: channel?.identifier || null,
          enquiryId: enquiry?.id ?? null,
          enquiryStatus: enquiry?.status ?? null,
          assignedTo: enquiry?.assignedTo ?? null,
          messageCount: summary.lastMessageSeq, // seq IS the per-contact message count
          lastMessage: summary.lastMessagePreview
            ? {
              content: summary.lastMessagePreview,
              direction: summary.lastMessageDirection,
              channel: summary.lastMessageChannel,
              createdAt: summary.lastMessageAt,
            }
            : null,
          lastActivityAt: summary.lastMessageAt,
          lastMessageSeq: summary.lastMessageSeq,
          lastReadSeq: summary.lastReadSeq,
          draft: draft
            ? {
              body: draft.body,
              attachmentCount: draft._count.attachments,
              channel: draft.channel,
            }
            : null,
        };
      })
      .filter(Boolean) as any[];
    // Sort by last message time (most recent first)
    conversations.sort((a, b) => {
      const timeA = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const timeB = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
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
          orderBy: { seq: 'asc' }, // seq is authoritative; createdAt stays on the row for display only
          include: {
            sentByUser: {
              select: { id: true, displayName: true, userName: true },
            },
            attachments: true,
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

  async toggleMessageStar(messageId: string) {
    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
    });

    if (!msg) {
      throw new NotFoundException(`Message "${messageId}" not found`);
    }

    const updated = await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data: { isStarred: !msg.isStarred },
    });

    this.eventEmitter.emit('message.star.toggled', {
      contactId: msg.contactId,
      messageId: msg.id,
      isStarred: updated.isStarred,
    });

    return updated;
  }

  async getStarredMessages(contactId: string) {
    return this.prisma.conversationMessage.findMany({
      where: {
        isStarred: true,
        contactId, // direct field now — no need to join through enquiry
      },
      include: {
        sentByUser: {
          select: { id: true, displayName: true, userName: true },
        },
        attachments: {
          select: {
            id: true,
            kind: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            cdnUrl: true,
            width: true,
            height: true,
            durationMs: true,
          },
        },
      },
      orderBy: { seq: 'desc' }, // seq is authoritative; createdAt stays on the row for display only
    });
  }
}
