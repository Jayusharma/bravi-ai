// search.service.ts — Unified search across contacts and conversation messages.

import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

const MAX_RESULTS = 20;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches contacts by name/channel identifier AND messages by content.
   * If contactId is provided, messages are scoped to that contact's enquiries.
   */
  async searchUnified(q: string, contactId?: string, limit = MAX_RESULTS) {
    if (!q.trim()) return { contacts: [], messages: [] };

    const cap = Math.min(limit, 50);

    const [contacts, messages] = await Promise.all([
      // Skip contact search when scoped to a specific contact
      contactId ? Promise.resolve([]) : this.searchContacts(q, cap),
      this.searchMessages(q, cap, contactId),
    ]);

    return { contacts, messages };
  }

  /** Searches contacts by displayName or channel identifier */
  private async searchContacts(q: string, limit: number) {
    return this.prisma.contact.findMany({
      where: {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { channels: { some: { identifier: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      include: {
        channels: { select: { channel: true, identifier: true, isPrimary: true } },
        enquiries: {
          where: { status: { notIn: ['CONVERTED', 'CLOSED_LOST'] } },
          orderBy: { lastActivityAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
      take: limit,
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Searches conversation messages by content (optionally scoped to a contact) */
  private async searchMessages(q: string, limit: number, contactId?: string) {
    return this.prisma.conversationMessage.findMany({
      where: {
        content: { contains: q, mode: 'insensitive' },
        isDeleted: false,
        ...(contactId
          ? { enquiry: { contactId } }
          : {}),
      },
      include: {
        enquiry: {
          select: {
            id: true,
            status: true,
            contact: { select: { id: true, displayName: true } },
          },
        },
        sentByUser: { select: { id: true, displayName: true, userName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
