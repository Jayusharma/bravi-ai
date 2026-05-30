// whatsapp-window.service.ts — Checks the WhatsApp 24-hour messaging window for a contact.

import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MessageChannel, MessageDirection } from '@prisma/client';

const WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WhatsAppWindowService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns true if the customer has sent an inbound WhatsApp message in the last 24 hours */
  async isWindowOpen(contactId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - WINDOW_MS);

    const recent = await this.prisma.conversationMessage.findFirst({
      where: {
        enquiry: { contactId },
        channel: MessageChannel.WHATSAPP,
        direction: MessageDirection.INBOUND,
        createdAt: { gte: cutoff },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    return recent !== null;
  }
}
