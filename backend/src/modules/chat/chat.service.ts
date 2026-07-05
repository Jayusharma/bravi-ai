import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/database/prisma.service';
import { StorageService } from '../storage/storage.service';
// Shared MIME → AttachmentKind map (single source of truth for upload rules)
import { MIME_TO_KIND } from '../outbound/draft.service';
import {
  AttachmentKind,
  ChatConversation,
  ChatConversationType,
  ChatMessageType,
  ChatParticipantRole,
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
  // Raw reaction rows — the client groups them into {emoji, count, reactedByMe}.
  // (Raw on purpose: the same hydrated message is broadcast to the whole room,
  // so it can't carry per-user flags.)
  reactions: { select: { userId: true, emoji: true } },
} satisfies Prisma.ChatMessageInclude;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storage: StorageService,
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
   * Ensure the user is a participant of the conversation.
   * Idempotent: upsert on the unique (conversationId, userId) pair.
   *
   * ONLY called from: the general channel resolve (org-wide by definition),
   * explicit add-member, and DM creation. Never as a silent auto-join for
   * arbitrary channels — membership is the single source of access.
   */
  async ensureMembership(
    conversationId: string,
    userId: string,
    role: ChatParticipantRole = ChatParticipantRole.MEMBER,
  ): Promise<void> {
    await this.prisma.chatParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, role },
      update: { isActive: true },
    });
  }

  /**
   * THE access check. True only when the user has an ACTIVE membership row.
   * Public (boolean) so the socket gateway can silently refuse `chat:join`.
   */
  async isActiveMember(conversationId: string, userId: string): Promise<boolean> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { isActive: true },
    });
    return participant?.isActive === true;
  }

  /**
   * Guard called at the top of EVERY conversation read/write below.
   * No membership row, or isActive=false (removed/left) → 403.
   * With { admin: true }, additionally requires ChatParticipantRole.ADMIN.
   */
  private async assertActiveMember(
    conversationId: string,
    userId: string,
    opts: { admin?: boolean } = {},
  ): Promise<void> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { isActive: true, role: true },
    });
    if (!participant?.isActive) {
      throw new ForbiddenException('You are not a member of this conversation.');
    }
    if (opts.admin && participant.role !== ChatParticipantRole.ADMIN) {
      throw new ForbiddenException('Only channel admins can do this.');
    }
  }

  /**
   * Resolves the org-wide general channel (COMMON_ROOM key) for the caller.
   * Auto-join is kept HERE ONLY: the general channel is org-wide by definition —
   * every other conversation requires an explicit membership row (add-member/DM).
   */
  async getRoomForUser(userId: string) {
    const room = await this.getOrCreateCommonRoom();
    await this.ensureMembership(room.id, userId);
    return this.getRoomMeta(room.id, userId);
  }

  /**
   * Bootstrap metadata for ANY conversation the user is a member of — what the
   * room view needs to open: read boundary, unread count, first-unread anchor,
   * group receipts. Members only.
   */
  async getRoomMeta(conversationId: string, userId: string) {
    await this.assertActiveMember(conversationId, userId);

    const room = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!room) throw new NotFoundException('Conversation not found');

    const [memberCount, participant] = await Promise.all([
      this.prisma.chatParticipant.count({
        where: { conversationId: room.id, isActive: true },
      }),
      this.prisma.chatParticipant.findUnique({
        where: { conversationId_userId: { conversationId: room.id, userId } },
        select: { lastReadAt: true, role: true },
      }),
    ]);

    const [receipts, unreadCount] = await Promise.all([
      this.computeRoomReceipts(room.id),
      this.getUnreadCount(room.id, userId),
    ]);

    // The oldest unread message — the page opens positioned here so the user
    // reads from where they left off (works regardless of how many are unread).
    let firstUnreadMessageId: string | null = null;
    if (unreadCount > 0) {
      const firstUnread = await this.prisma.chatMessage.findFirst({
        where: {
          conversationId: room.id,
          isDeleted: false,
          senderId: { not: userId },
          ...(participant?.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      firstUnreadMessageId = firstUnread?.id ?? null;
    }

    // DM display name = the other person's name (the row's own name is null)
    let displayName = room.name;
    if (room.type === ChatConversationType.DIRECT) {
      const partner = await this.prisma.chatParticipant.findFirst({
        where: { conversationId: room.id, userId: { not: userId } },
        select: { user: { select: { displayName: true, userName: true } } },
      });
      displayName = partner?.user.displayName || partner?.user.userName || 'Direct Message';
    }

    return {
      id: room.id,
      type: room.type,
      name: displayName,
      description: room.description,
      key: room.key, // 'COMMON_ROOM' marks #general
      archivedAt: room.archivedAt,
      myRole: participant?.role ?? null,
      lastMessageAt: room.lastMessageAt,
      memberCount,
      lastReadAt: participant?.lastReadAt ?? null, // read boundary for the unread divider
      unreadCount,
      firstUnreadMessageId,
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
    // isActive filter: a removed member's stale socket can't move the watermark.
    await this.prisma.chatParticipant.updateMany({
      where: { conversationId, userId, isActive: true },
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
      where: { conversationId, userId, isActive: true },
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
    userId: string,
  ) {
    await this.assertActiveMember(conversationId, userId); // membership = access
    const take = opts.limit ?? DEFAULT_PAGE_SIZE;

    // Fetch one extra row to know whether an older page exists.
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        NOT: { deletedFor: { has: userId } },
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
    content?: string;
    type?: ChatMessageType;
    parentMessageId?: string;
    attachments?: {
      kind: AttachmentKind;
      fileName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
      cdnUrl?: string;
    }[];
  }) {
    const { conversationId, senderId } = input;
    const attachments = input.attachments ?? [];
    const content = input.content?.trim() || null;

    if (!content && attachments.length === 0) {
      throw new BadRequestException('Message needs text or at least one attachment.');
    }

    // Members only — no auto-join. Access comes from an explicit membership row.
    await this.assertActiveMember(conversationId, senderId);

    // Archived channels are read-only history — no new messages.
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { archivedAt: true },
    });
    if (conversation?.archivedAt) {
      throw new BadRequestException('This channel is archived — it is read-only.');
    }

    // Media-only message → type reflects the payload (all images = IMAGE, else DOCUMENT).
    const derivedType =
      input.type ??
      (attachments.length > 0 && !content
        ? attachments.every((a) => a.kind === AttachmentKind.IMAGE)
          ? ChatMessageType.IMAGE
          : ChatMessageType.DOCUMENT
        : ChatMessageType.TEXT);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          conversationId,
          senderId,
          type: derivedType,
          content,
          parentMessageId: input.parentMessageId || null,
          // Upload already happened (uploadAttachment) — these are just the rows.
          ...(attachments.length > 0 ? { attachments: { create: attachments } } : {}),
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
   * Load the NEWER page after a cursor (oldest→newest). Used to scroll down
   * through a large unread backlog / an anchored window toward the live tail.
   * `hasMore = false` means this page reaches the newest message.
   */
  async getNewerMessages(
    conversationId: string,
    cursor: string,
    limit = 30,
    userId: string,
  ) {
    await this.assertActiveMember(conversationId, userId);
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        NOT: { deletedFor: { has: userId } },
      },
      orderBy: { createdAt: 'asc' },
      cursor: { id: cursor },
      skip: 1,
      take: limit + 1,
      include: MESSAGE_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      messages: page, // oldest → newest
      nextCursor: page.length > 0 ? page[page.length - 1].id : cursor,
      hasMore,
    };
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
    userId: string,
  ) {
    await this.assertActiveMember(conversationId, userId);
    const target = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        NOT: { deletedFor: { has: userId } },
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
          NOT: { deletedFor: { has: userId } },
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
          NOT: { deletedFor: { has: userId } },
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
  async searchMessages(conversationId: string, q: string, limit = 50, userId: string) {
    await this.assertActiveMember(conversationId, userId);
    const term = q.trim();
    if (!term) return { messages: [] };

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        isDeleted: false,
        content: { contains: term, mode: 'insensitive' },
        NOT: { deletedFor: { has: userId } },
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
  async getMembers(conversationId: string, userId: string) {
    await this.assertActiveMember(conversationId, userId);
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
    await this.assertActiveMember(conversationId, userId);
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

  /** Starred messages of a conversation — powers the room's "Starred" tab. Newest first. */
  async getStarredMessages(conversationId: string, userId: string): Promise<any[]> {
    await this.assertActiveMember(conversationId, userId);
    return this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        isStarred: true,
        isDeleted: false,
        NOT: { deletedFor: { has: userId } },
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async togglePinMessage(messageId: string, roomId: string, userId: string): Promise<any> {
    await this.assertActiveMember(roomId, userId);
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

  async toggleStarMessage(messageId: string, roomId: string, userId: string): Promise<any> {
    await this.assertActiveMember(roomId, userId);
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
    await this.assertActiveMember(roomId, userId);
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
    await this.assertActiveMember(roomId, userId);
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
    await this.assertActiveMember(msg.conversationId, userId);

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

  // ═══════════════════════════════════════════════════════════════════
  // CHANNELS & DMs — Discord-style multi-conversation layer
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Everything the sidebar needs in one call: every channel + DM the user is an
   * ACTIVE member of, each with unread count, last-message preview and member count.
   * Unreads come from ONE grouped SQL query (not N+1 counts).
   */
  async listConversations(userId: string, includeArchived = false) {
    const memberships = await this.prisma.chatParticipant.findMany({
      where: { userId, isActive: true },
      select: { conversationId: true, role: true, lastReadAt: true },
    });
    if (memberships.length === 0) return [];
    const roleByConv = new Map(memberships.map((m) => [m.conversationId, m.role]));
    const ids = memberships.map((m) => m.conversationId);

    const conversations = await this.prisma.chatConversation.findMany({
      where: { id: { in: ids }, ...(includeArchived ? {} : { archivedAt: null }) },
      include: {
        _count: { select: { participants: { where: { isActive: true } } } },
        // Last visible message for the sidebar preview line
        messages: {
          where: { isDeleted: false, NOT: { deletedFor: { has: userId } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            type: true,
            createdAt: true,
            senderId: true,
            sender: { select: { displayName: true, userName: true } },
          },
        },
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    // DMs have name=null — the display name is the OTHER person's name.
    const dmIds = conversations.filter((c) => c.type === ChatConversationType.DIRECT).map((c) => c.id);
    const dmPartners = dmIds.length
      ? await this.prisma.chatParticipant.findMany({
          where: { conversationId: { in: dmIds }, userId: { not: userId } },
          select: {
            conversationId: true,
            userId: true,
            user: { select: { displayName: true, userName: true } },
          },
        })
      : [];
    const partnerByConv = new Map(dmPartners.map((p) => [p.conversationId, p]));

    // One grouped query: unread per conversation = messages newer than MY lastReadAt,
    // not mine, not deleted, not deleted-for-me.
    const unreadRows = await this.prisma.$queryRaw<{ conversationId: string; count: bigint }[]>`
      SELECT m."conversationId", COUNT(*)::bigint AS count
      FROM "ChatMessage" m
      JOIN "ChatParticipant" p
        ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
      WHERE m."conversationId" IN (${Prisma.join(ids)})
        AND p."isActive" = true
        AND m."isDeleted" = false
        AND m."senderId" <> ${userId}
        AND NOT (${userId} = ANY(m."deletedFor"))
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
      GROUP BY m."conversationId"
    `;
    const unreadByConv = new Map(unreadRows.map((r) => [r.conversationId, Number(r.count)]));

    return conversations.map((c) => {
      const partner = partnerByConv.get(c.id);
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        type: c.type,
        // Channel → its name; DM → the other person's name
        name:
          c.type === ChatConversationType.DIRECT
            ? partner?.user.displayName || partner?.user.userName || 'Direct Message'
            : c.name,
        description: c.description,
        key: c.key, // 'COMMON_ROOM' marks the general channel (leave disabled in UI)
        archivedAt: c.archivedAt,
        memberCount: c._count.participants,
        myRole: roleByConv.get(c.id),
        dmPartnerId: partner?.userId ?? null,
        lastMessageAt: c.lastMessageAt,
        lastMessage: last
          ? {
              content: last.content,
              type: last.type,
              senderId: last.senderId,
              senderName: last.sender.displayName || last.sender.userName,
              createdAt: last.createdAt,
            }
          : null,
        unreadCount: unreadByConv.get(c.id) ?? 0,
      };
    });
  }

  /**
   * Create a named channel. Caller (already CASL-checked: create:chatchannel)
   * becomes the channel ADMIN; listed members join as MEMBER.
   */
  async createChannel(creatorId: string, input: { name: string; description?: string; memberIds?: string[] }) {
    // Only add users that actually exist and are active — silently drop the rest.
    const requestedIds = [...new Set(input.memberIds ?? [])].filter((id) => id !== creatorId);
    const validUsers = requestedIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: requestedIds }, isActive: true },
          select: { id: true },
        })
      : [];

    const channel = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.chatConversation.create({
        data: {
          type: ChatConversationType.GROUP,
          name: input.name,
          description: input.description ?? null,
          createdBy: creatorId,
        },
      });
      await tx.chatParticipant.create({
        data: { conversationId: conv.id, userId: creatorId, role: ChatParticipantRole.ADMIN },
      });
      if (validUsers.length) {
        await tx.chatParticipant.createMany({
          data: validUsers.map((u) => ({ conversationId: conv.id, userId: u.id })),
        });
      }
      return conv;
    });

    await this.emitConversationUpdated(channel.id); // members' sidebars refresh live
    return channel;
  }

  /**
   * Edit a channel's name/description, or archive/restore it.
   * Requires channel ADMIN (org-admins with manage:chatchannel bypass via `bypassAdmin`).
   */
  async updateChannel(
    conversationId: string,
    userId: string,
    input: { name?: string; description?: string; archived?: boolean },
    bypassAdmin = false,
  ) {
    const conv = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Channel not found');
    if (conv.type === ChatConversationType.DIRECT) {
      throw new BadRequestException('Direct messages cannot be edited.');
    }
    if (!bypassAdmin) await this.assertActiveMember(conversationId, userId, { admin: true });

    // The org-wide general channel can never be archived.
    if (input.archived && conv.key === COMMON_ROOM_KEY) {
      throw new BadRequestException('The general channel cannot be archived.');
    }

    const updated = await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      },
    });

    await this.emitConversationUpdated(conversationId);
    return updated;
  }

  /** Add users to a channel (channel ADMIN only). Idempotent — rejoining reactivates. */
  async addMembers(conversationId: string, actorId: string, userIds: string[], bypassAdmin = false) {
    const conv = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Channel not found');
    if (conv.type === ChatConversationType.DIRECT) {
      throw new BadRequestException('Direct messages cannot have members added.');
    }
    if (!bypassAdmin) await this.assertActiveMember(conversationId, actorId, { admin: true });

    const validUsers = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    });
    for (const u of validUsers) {
      await this.ensureMembership(conversationId, u.id);
    }

    await this.emitConversationUpdated(conversationId);
    return this.getMembers(conversationId, actorId);
  }

  /**
   * Remove a member (channel ADMIN) or leave yourself (anyone).
   * Soft-remove: isActive=false — the membership row keeps lastReadAt history.
   * Emits `chat.membership.removed` so the gateway can kick their sockets live.
   */
  async removeMember(conversationId: string, actorId: string, targetUserId: string, bypassAdmin = false) {
    const conv = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Channel not found');
    if (conv.type === ChatConversationType.DIRECT) {
      throw new BadRequestException('You cannot leave a direct message.');
    }
    if (conv.key === COMMON_ROOM_KEY) {
      throw new BadRequestException('The general channel is org-wide — members cannot leave or be removed.');
    }

    const isSelfLeave = actorId === targetUserId;
    if (!isSelfLeave && !bypassAdmin) {
      await this.assertActiveMember(conversationId, actorId, { admin: true });
    }

    await this.prisma.chatParticipant.updateMany({
      where: { conversationId, userId: targetUserId },
      data: { isActive: false },
    });

    // Live kick: gateway forces the user's sockets out of the room on this event.
    this.eventEmitter.emit('chat.membership.removed', { conversationId, userId: targetUserId });
    await this.emitConversationUpdated(conversationId);
  }

  /**
   * Open (or find) the 1-to-1 DM with another user — IDEMPOTENT.
   * The sorted-pair key ('DM:<a>:<b>') is unique, so the same two users always
   * land in the same conversation. P2002 race handled like getOrCreateCommonRoom.
   */
  async openDm(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('You cannot DM yourself.');
    }
    const other = await this.prisma.user.findUnique({
      where: { id: otherUserId },
      select: { id: true, isActive: true },
    });
    if (!other?.isActive) throw new NotFoundException('User not found');

    const key = `DM:${[userId, otherUserId].sort().join(':')}`;

    const existing = await this.prisma.chatConversation.findUnique({ where: { key } });
    if (existing) {
      // Re-activate both sides in case one previously deactivated
      await this.ensureMembership(existing.id, userId);
      await this.ensureMembership(existing.id, otherUserId);
      return existing;
    }

    try {
      const dm = await this.prisma.$transaction(async (tx) => {
        const conv = await tx.chatConversation.create({
          data: { type: ChatConversationType.DIRECT, key, createdBy: userId },
        });
        await tx.chatParticipant.createMany({
          data: [
            { conversationId: conv.id, userId },
            { conversationId: conv.id, userId: otherUserId },
          ],
        });
        return conv;
      });
      await this.emitConversationUpdated(dm.id);
      return dm;
    } catch (error) {
      // Concurrent open from both sides — the key is unique, re-fetch the winner.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.prisma.chatConversation.findUnique({ where: { key } });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  /**
   * Files tab: every attachment in the conversation, newest first, paginated.
   * A filtered query over ChatAttachment→ChatMessage — no separate storage.
   */
  async getChannelFiles(conversationId: string, userId: string, opts: { cursor?: string; limit?: number } = {}) {
    await this.assertActiveMember(conversationId, userId);
    const take = opts.limit ?? 30;

    const rows = await this.prisma.chatAttachment.findMany({
      where: {
        message: {
          conversationId,
          isDeleted: false,
          NOT: { deletedFor: { has: userId } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: {
        message: {
          select: {
            id: true,
            senderId: true,
            createdAt: true,
            sender: { select: { displayName: true, userName: true } },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      files: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ATTACHMENTS & REACTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Stage a file for a chat message: upload to R2 under chat/<conversationId>/,
   * return a descriptor. NO DB row yet — the client sends the descriptor back
   * with the message and sendMessage creates the ChatAttachment rows.
   */
  async uploadAttachment(conversationId: string, userId: string, file: Express.Multer.File) {
    await this.assertActiveMember(conversationId, userId);

    const kind = MIME_TO_KIND[file.mimetype];
    if (!kind) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);

    const storageKey = this.storage.generateKey(`chat/${conversationId}`, file.originalname);
    const cdnUrl = await this.storage.uploadBuffer(storageKey, file.buffer, file.mimetype);

    return {
      kind,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageKey,
      cdnUrl,
    };
  }

  /**
   * Toggle an emoji reaction: first tap adds, same tap again removes.
   * The (message, user, emoji) unique constraint makes this race-safe.
   */
  async toggleReaction(conversationId: string, messageId: string, userId: string, emoji: string) {
    await this.assertActiveMember(conversationId, userId);

    const msg = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId, isDeleted: false },
      select: { id: true },
    });
    if (!msg) throw new NotFoundException('Message not found in this conversation');

    let added: boolean;
    try {
      await this.prisma.chatMessageReaction.create({
        data: { chatMessageId: messageId, userId, emoji },
      });
      added = true;
    } catch (error) {
      // Already reacted with this emoji → the toggle means REMOVE.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.prisma.chatMessageReaction.deleteMany({
          where: { chatMessageId: messageId, userId, emoji },
        });
        added = false;
      } else {
        throw error;
      }
    }

    // Broadcast so every open room updates its reaction chips live.
    this.eventEmitter.emit('chat.message.reacted', { conversationId, messageId, userId, emoji, added });

    const reactions = await this.prisma.chatMessageReaction.findMany({
      where: { chatMessageId: messageId },
      select: { userId: true, emoji: true },
    });
    return { messageId, reactions };
  }

  /**
   * Ids of every ACTIVE member. Used by the broadcast layer to target
   * membership-scoped events at member user-rooms (never a global emit).
   */
  async getActiveMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.chatParticipant.findMany({
      where: { conversationId, isActive: true },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** Tells every ACTIVE member's sidebar to refresh (rename/members/archive/new conversation). */
  private async emitConversationUpdated(conversationId: string): Promise<void> {
    this.eventEmitter.emit('chat.conversation.updated', {
      conversationId,
      memberIds: await this.getActiveMemberIds(conversationId),
    });
  }
}
