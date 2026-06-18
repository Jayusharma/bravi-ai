import { Injectable, Logger } from '@nestjs/common';
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

    return {
      id: room.id,
      type: room.type,
      name: room.name,
      lastMessageAt: room.lastMessageAt,
      memberCount,
      lastReadAt: participant?.lastReadAt ?? null,
    };
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
  ) {
    const take = opts.limit ?? DEFAULT_PAGE_SIZE;

    // Fetch one extra row to know whether an older page exists.
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId },
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
}
