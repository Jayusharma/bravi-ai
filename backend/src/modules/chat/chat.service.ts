import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/database/prisma.service';
import {
  ChatConversation,
  ChatConversationType,
  ChatMessageType,
  Prisma,
} from '@prisma/client';

/**
 * Stable key for the singleton org-wide common room.
 * Phase 1 ships exactly one ChatConversation carrying this key.
 * (1:1 DMs / named groups later are just more rows with key = null.)
 */
const COMMON_ROOM_KEY = 'COMMON_ROOM';
const COMMON_ROOM_NAME = 'Team Chat';

const DEFAULT_PAGE_SIZE = 30;

/**
 * Shared shape for hydrating a chat message everywhere it's returned
 * (history, real-time broadcast, send ack). Keeps payloads consistent.
 */
const MESSAGE_INCLUDE = {
  sender: { select: { id: true, displayName: true, userName: true } },
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
  // Minimal enquiry summary for ENQUIRY_CARD messages — kept current at read time.
  enquiry: {
    select: {
      id: true,
      status: true,
      intent: true,
      contact: { select: { displayName: true } },
    },
  },
  parentMessage: {
    include: {
      sender: { select: { id: true, displayName: true, userName: true } },
    },
  },
} satisfies Prisma.ChatMessageInclude;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Find-or-create the single org-wide common room.
   * Deterministic via the unique `key` column. Handles the concurrent-create
   * race (P2002) the same way ContactService.resolve() does.
   */
  async getOrCreateCommonRoom(): Promise<ChatConversation> {
    const existing = await this.prisma.chatConversation.findUnique({
      where: { key: COMMON_ROOM_KEY },
    });
    if (existing) return existing;

    try {
      return await this.prisma.chatConversation.create({
        data: {
          key: COMMON_ROOM_KEY,
          type: ChatConversationType.GROUP,
          name: COMMON_ROOM_NAME,
        },
      });
    } catch (error) {
      // Another request created it first — re-fetch and return that row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.prisma.chatConversation.findUnique({
          where: { key: COMMON_ROOM_KEY },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  /**
   * Ensure the user is a participant of the conversation (auto-join).
   * Idempotent: upsert on the unique (conversationId, userId) pair.
   */
  async ensureMembership(conversationId: string, userId: string): Promise<void> {
    await this.prisma.chatParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId },
      update: { isActive: true },
    });
  }

  /**
   * Entry point for the chat page: resolves the common room, makes sure the
   * caller is a member, and returns lightweight room metadata.
   */
  async getRoomForUser(userId: string) {
    const room = await this.getOrCreateCommonRoom();
    await this.ensureMembership(room.id, userId);

    const [memberCount, participant] = await Promise.all([
      this.prisma.chatParticipant.count({
        where: { conversationId: room.id, isActive: true },
      }),
      this.prisma.chatParticipant.findUnique({
        where: { conversationId_userId: { conversationId: room.id, userId } },
        select: { lastReadAt: true },
      }),
    ]);

    const [receipts, unreadCount] = await Promise.all([
      this.computeRoomReceipts(room.id),
      this.getUnreadCount(room.id, userId),
    ]);

    return {
      id: room.id,
      type: room.type,
      name: room.name,
      lastMessageAt: room.lastMessageAt,
      memberCount,
      lastReadAt: participant?.lastReadAt ?? null, // read boundary for the unread divider
      unreadCount,
      receipts, // { deliveredUpTo, readUpTo } — drives WhatsApp-style ticks
    };
  }

  /**
   * Count of messages this user hasn't read yet (newer than their lastReadAt,
   * not their own, not deleted). Returns 0 if they aren't a participant.
   */
  async getUnreadCount(conversationId: string, userId: string): Promise<number> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    if (!participant) return 0;

    return this.prisma.chatMessage.count({
      where: {
        conversationId,
        isDeleted: false,
        senderId: { not: userId },
        NOT: { deletedFor: { has: userId } },
        ...(participant.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {}),
      },
    });
  }

  /**
   * Read-only unread count for the common room — used to seed the sidebar badge
   * on app load WITHOUT auto-joining (returns 0 for users who never opened chat).
   */
  async getUnreadForUser(userId: string): Promise<{ conversationId: string | null; count: number }> {
    const room = await this.prisma.chatConversation.findUnique({
      where: { key: COMMON_ROOM_KEY },
      select: { id: true },
    });
    if (!room) return { conversationId: null, count: 0 };
    return { conversationId: room.id, count: await this.getUnreadCount(room.id, userId) };
  }

  /**
   * Group read/delivery watermarks for the whole room.
   *
   * WhatsApp group semantics: a message is DELIVERED/READ only once EVERY
   * active member is past it — so we take the MINIMUM watermark across members.
   * A null anywhere (a member who hasn't received/read yet) keeps it null.
   * With ≤1 member there's no one else to deliver to, so both are null.
   */
  async computeRoomReceipts(
    conversationId: string,
  ): Promise<{ deliveredUpTo: Date | null; readUpTo: Date | null }> {
    const members = await this.prisma.chatParticipant.findMany({
      where: { conversationId, isActive: true },
      select: { lastDeliveredAt: true, lastReadAt: true },
    });

    if (members.length <= 1) return { deliveredUpTo: null, readUpTo: null };

    return {
      deliveredUpTo: this.minWatermark(members.map((m) => m.lastDeliveredAt)),
      readUpTo: this.minWatermark(members.map((m) => m.lastReadAt)),
    };
  }

  /** Min of a list of timestamps; null if the list is empty or contains any null. */
  private minWatermark(dates: (Date | null)[]): Date | null {
    if (dates.length === 0) return null;
    let min: Date | null = null;
    for (const d of dates) {
      if (d === null) return null; // someone hasn't reached this state yet
      if (min === null || d < min) min = d;
    }
    return min;
  }

  /**
   * Mark messages as delivered to a member (their device received them).
   * Advances lastDeliveredAt and re-broadcasts the room's receipts.
   */
  async markDelivered(conversationId: string, userId: string): Promise<void> {
    await this.prisma.chatParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastDeliveredAt: new Date() },
    });
    await this.emitReceipts(conversationId);
  }

  /**
   * Mark the room as read by a member (they're viewing it).
   * Reading implies delivery, so both watermarks advance.
   */
  async markRead(conversationId: string, userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.chatParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: now, lastDeliveredAt: now },
    });
    await this.emitReceipts(conversationId);
  }

  /** Recompute room receipts and emit them for the real-time broadcast layer. */
  private async emitReceipts(conversationId: string): Promise<void> {
    const receipts = await this.computeRoomReceipts(conversationId);
    this.eventEmitter.emit('chat.receipts.updated', {
      conversationId,
      deliveredUpTo: receipts.deliveredUpTo,
      readUpTo: receipts.readUpTo,
    });
  }

  /**
   * Paginated message history for a conversation, newest-first on the wire
   * but returned oldest→newest so the UI can render top-to-bottom directly.
   *
   * Cursor pagination: pass the oldest message id you currently hold as
   * `cursor` to fetch the previous (older) page. `nextCursor` is the id to
   * pass next; null when there are no older messages.
   */
  async getMessages(
    conversationId: string,
    opts: { cursor?: string; limit?: number } = {},
    userId?: string,
  ) {
    const take = opts.limit ?? DEFAULT_PAGE_SIZE;

    // Fetch one extra row to know whether an older page exists.
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(userId ? { NOT: { deletedFor: { has: userId } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor
        ? { cursor: { id: opts.cursor }, skip: 1 }
        : {}),
      include: MESSAGE_INCLUDE,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    // Oldest item in this (desc) page is the cursor for the next older page.
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      messages: page.reverse(), // oldest → newest for direct rendering
      nextCursor,
      hasMore,
    };
  }

  /**
   * Persist a new message and announce it.
   *
   * Single transaction: create the message, bump the conversation's
   * lastMessageAt, and advance the sender's own read watermark (you've
   * "read" what you just sent). Emits `chat.message.created` for the
   * real-time broadcast layer (wired in a later step).
   */
  async sendMessage(input: {
    conversationId: string;
    senderId: string;
    content: string;
    type?: ChatMessageType;
    parentMessageId?: string;
  }) {
    const { conversationId, senderId } = input;

    // Make sure the sender is a participant (auto-join the common room).
    await this.ensureMembership(conversationId, senderId);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          conversationId,
          senderId,
          type: input.type ?? ChatMessageType.TEXT,
          content: input.content,
          parentMessageId: input.parentMessageId || null,
        },
        include: MESSAGE_INCLUDE,
      });

      await tx.chatConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });

      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId: senderId } },
        data: { lastReadAt: created.createdAt },
      });

      return created;
    });

    this.eventEmitter.emit('chat.message.created', {
      conversationId,
      messageId: message.id,
    });

    return message;
  }

  /**
   * Load a window of messages centered on a target message (for jumping to a
   * search result that isn't in the currently-loaded page).
   *
   * Returns oldest→newest: [<=before older] + target + [<=after newer], plus
   * flags so the client knows whether more history exists in each direction.
   * `hasMoreNewer = false` means the window reaches the live tail.
   */
  async getMessagesAround(
    conversationId: string,
    messageId: string,
    before = 25,
    after = 25,
    userId?: string,
  ) {
    const target = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        ...(userId ? { NOT: { deletedFor: { has: userId } } } : {}),
      },
      include: MESSAGE_INCLUDE,
    });
    if (!target) {
      throw new NotFoundException('Message not found in this conversation');
    }

    const [olderDesc, newerAsc] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: {
          conversationId,
          ...(userId ? { NOT: { deletedFor: { has: userId } } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        cursor: { id: messageId },
        skip: 1,
        take: before,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.chatMessage.findMany({
        where: {
          conversationId,
          ...(userId ? { NOT: { deletedFor: { has: userId } } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        cursor: { id: messageId },
        skip: 1,
        take: after,
        include: MESSAGE_INCLUDE,
      }),
    ]);

    return {
      messages: [...olderDesc.reverse(), target, ...newerAsc],
      hasMoreOlder: olderDesc.length === before,
      hasMoreNewer: newerAsc.length === after,
    };
  }

  /**
   * Keyword search within a conversation (case-insensitive substring on
   * message content). Mirrors the messaging module's simple `contains` search.
   * Returns newest matches first.
   */
  async searchMessages(conversationId: string, q: string, limit = 50, userId?: string) {
    const term = q.trim();
    if (!term) return { messages: [] };

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        isDeleted: false,
        content: { contains: term, mode: 'insensitive' },
        ...(userId ? { NOT: { deletedFor: { has: userId } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: MESSAGE_INCLUDE,
    });

    return { messages };
  }

  /** Fetch a single hydrated message — used by the broadcast layer. */
  getMessageById(messageId: string) {
    return this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
  }

  /** Active members of a conversation with their name, org role, and presence. */
  async getMembers(conversationId: string) {
    const participants = await this.prisma.chatParticipant.findMany({
      where: { conversationId, isActive: true },
      select: {
        userId: true,
        user: { select: { displayName: true, userName: true, role: true } },
      },
    });

    // UserPresence is a standalone table (no relation) — fetch + merge.
    const presences = await this.prisma.userPresence.findMany({
      where: { userId: { in: participants.map((p) => p.userId) } },
      select: { userId: true, isOnline: true, lastSeenAt: true },
    });
    const presenceById = new Map(presences.map((p) => [p.userId, p]));

    return participants
      .map((p) => {
        const presence = presenceById.get(p.userId);
        return {
          userId: p.userId,
          displayName: p.user.displayName,
          userName: p.user.userName,
          role: p.user.role,
          isOnline: presence?.isOnline ?? false,
          lastSeenAt: presence?.lastSeenAt ?? null,
        };
      })
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const an = a.displayName || a.userName;
        const bn = b.displayName || b.userName;
        return an.localeCompare(bn);
      });
  }

  async getPinnedMessages(conversationId: string, userId: string): Promise<any[]> {
    return this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        isPinned: true,
        isDeleted: false,
        NOT: { deletedFor: { has: userId } },
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async togglePinMessage(messageId: string, roomId: string): Promise<any> {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { isPinned: !msg.isPinned },
      include: MESSAGE_INCLUDE,
    });

    this.eventEmitter.emit('chat.message.pinned', {
      conversationId: roomId,
      messageId,
      isPinned: updated.isPinned,
    });

    return updated;
  }

  async toggleStarMessage(messageId: string, roomId: string): Promise<any> {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { isStarred: !msg.isStarred },
      include: MESSAGE_INCLUDE,
    });

    this.eventEmitter.emit('chat.message.starred', {
      conversationId: roomId,
      messageId,
      isStarred: updated.isStarred,
    });

    return updated;
  }

  async editMessage(messageId: string, content: string, userId: string, roomId: string): Promise<any> {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) throw new Error('Cannot edit another user\'s message');
    if (msg.isDeleted) throw new Error('Cannot edit a deleted message');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    this.eventEmitter.emit('chat.message.edited', {
      conversationId: roomId,
      messageId,
      content,
      editedAt: updated.editedAt!.toISOString(),
    });

    return updated;
  }

  async deleteMessageForEveryone(messageId: string, userId: string, roomId: string): Promise<any> {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) throw new Error('Cannot delete another user\'s message for everyone');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        content: 'This message was deleted',
        deletedAt: new Date(),
      },
      include: MESSAGE_INCLUDE,
    });

    this.eventEmitter.emit('chat.message.deleted', {
      conversationId: roomId,
      messageId,
      isDeleted: true,
    });

    return updated;
  }

  async deleteMessageForMe(messageId: string, userId: string): Promise<any> {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');

    if (!msg.deletedFor.includes(userId)) {
      const updated = await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          deletedFor: {
            push: userId,
          },
        },
        include: MESSAGE_INCLUDE,
      });
      return updated;
    }

    return msg;
  }
}
