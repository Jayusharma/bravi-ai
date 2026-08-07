// app.event-handler.ts — SINGLE SOURCE OF TRUTH for all @OnEvent listeners.

/**
 * =====================================================
 * INTERNAL EVENT REGISTRY — Single source of truth
 * =====================================================
 * ALL @OnEvent listeners live in this file.
 * Injects AppGateway to emit socket events.
 * Injects services for business logic.
 *
 * Events handled here:
 *   - message.inbound.appended  → push message to contact room + global notification
 *   - enquiry.created           → broadcast contact list update
 *   - outbound.sent             → delivery status SENT to contact room
 *   - outbound.failed           → delivery failed to contact room
 *   - outbound.retry_queued     → status PENDING to contact room
 *   - outbound.delivery_updated → DELIVERED/READ to contact room
 *   - message.reaction_updated  → reaction update to contact room
 *   - message.deleted           → soft delete to contact room
 *   - message.edited            → edit to contact room
 *
 * Domain listeners that stay in their own services (NOT here):
 *   - message.outbound    → OutboundService (queues BullMQ job)
 *   - enquiry.qualified   → EnquiryService (creates enquiry from qualification)
 *
 * Removed (per Resolution 2 — drafts are private per-user, not broadcast):
 *   - outbound.draft_saved
 *   - outbound.draft_discarded
 *   - outbound.attachment_added
 * =====================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppGateway } from '../websocket/app.gateway';
import { ConversationService } from '../modules/messaging/messaging.service';
import { ChatService } from '../modules/chat/chat.service';
import { PrismaService } from '../database/prisma.service';
import { ROOMS, SOCKET_EVENTS } from '../common/constants/socket-events';

@Injectable()
export class AppEventHandler {
  private readonly logger = new Logger(AppEventHandler.name);

  constructor(
    private readonly gateway: AppGateway,
    private readonly conversationService: ConversationService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── INTERNAL TEAM CHAT ──────────────────────────────────────────────────

  /** New internal chat message — push the hydrated message to everyone in the room. */
  @OnEvent('chat.message.created')
  async onChatMessageCreated(payload: { conversationId: string; messageId: string }) {
    const message = await this.chatService.getMessageById(payload.messageId);
    if (!message) return;

    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_NEW, {
        conversationId: payload.conversationId,
        message,
      });

    // Unread notification — MEMBERS ONLY, via their personal user rooms.
    // Never a global emit: non-members must not even learn the channel exists.
    const memberIds = await this.chatService.getActiveMemberIds(payload.conversationId);
    const notification = {
      conversationId: payload.conversationId,
      messageId: message.id,
      senderId: message.senderId,
      preview: typeof message.content === 'string' ? message.content.substring(0, 80) : 'Attachment',
    };
    for (const memberId of memberIds) {
      if (memberId === message.senderId) continue; // no self-notification
      this.gateway.server.to(ROOMS.user(memberId)).emit(SOCKET_EVENTS.CHAT_NOTIFICATION, notification);
    }
  }

  /** Room read/delivery watermarks changed — push them so senders update their ticks. */
  @OnEvent('chat.receipts.updated')
  onChatReceiptsUpdated(payload: {
    conversationId: string;
    deliveredUpTo: Date | null;
    readUpTo: Date | null;
  }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_RECEIPTS, {
        conversationId: payload.conversationId,
        deliveredUpTo: payload.deliveredUpTo,
        readUpTo: payload.readUpTo,
      });
  }

  // ─── INBOUND MESSAGES ────────────────────────────────────────────────────

  /** Fast path: message appended to existing enquiry — push to chat + global notification + sidebar delta */
  @OnEvent('message.inbound.appended')
  async onInboundMessageAppended(payload: {
    contactId: string;
    enquiryId: string;
    message: any;
  }) {
    this.logger.log(`📡 Inbound message for contact ${payload.contactId} — broadcasting`);

    this.gateway.server
      .to(ROOMS.contact(payload.contactId))
      .emit(SOCKET_EVENTS.MESSAGE_NEW, {
        contactId: payload.contactId,
        enquiryId: payload.enquiryId,
        message: payload.message,
      });

    this.gateway.server.emit(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, {
      contactId: payload.contactId,
      enquiryId: payload.enquiryId,
      messagePreview:
        typeof payload.message?.content === 'string'
          ? payload.message.content.substring(0, 100)
          : 'New message',
      messageId: payload.message?.id,
    });

    await this.broadcastConversationDelta(payload.contactId, 'NEW_INBOUND');
  }

  /** Slow path: new enquiry created after qualification — insert full card into all sidebars */
  @OnEvent('enquiry.created')
  async onNewEnquiry(payload: { contactId: string; enquiryId: string }) {
    this.logger.log(`📡 New enquiry ${payload.enquiryId} for contact ${payload.contactId}`);

    this.gateway.server.emit(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, {
      contactId: payload.contactId,
      enquiryId: payload.enquiryId,
      messagePreview: 'New enquiry created',
      messageId: `enq-${payload.enquiryId}`,
    });

    await this.broadcastConversationNew(payload.contactId, payload.enquiryId);
  }

  /** Outbound message created via REST (e.g. forward) — push full message to the target contact room + sidebar delta */
  @OnEvent('message.outbound.broadcast')
  async onOutboundMessageBroadcast(payload: {
    contactId: string;
    enquiryId: string;
    messageId: string;
  }) {
    const message = await this.prisma.conversationMessage.findUnique({
      where: { id: payload.messageId },
      include: {
        sentByUser: { select: { id: true, displayName: true, userName: true } },
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
    });
    if (!message) return;

    this.gateway.server
      .to(ROOMS.contact(payload.contactId))
      .emit(SOCKET_EVENTS.MESSAGE_NEW, {
        contactId: payload.contactId,
        enquiryId: payload.enquiryId,
        message,
      });

    await this.broadcastConversationDelta(payload.contactId, 'OUTBOUND_SENT');
  }

  // ─── OUTBOUND DELIVERY STATUS ────────────────────────────────────────────

  /** Provider accepted the message — emit SENT status to contact room + sidebar preview delta */
  @OnEvent('outbound.sent')
  async onOutboundSent(payload: { messageId: string; enquiryId: string; sentAt: Date }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.OUTBOUND_SENT, { messageId: payload.messageId, enquiryId: payload.enquiryId, sentAt: payload.sentAt });
    await this.broadcastConversationDelta(contactId, 'OUTBOUND_SENT');
  }

  /** All retry attempts exhausted — emit failure to contact room */
  @OnEvent('outbound.failed')
  async onOutboundFailed(payload: {
    messageId: string;
    enquiryId: string;
    error?: string;
    attemptCount: number;
  }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.OUTBOUND_FAILED, {
        messageId: payload.messageId,
        enquiryId: payload.enquiryId,
        error: payload.error,
        attemptCount: payload.attemptCount,
      });
  }

  /** Manual retry queued — emit status update to contact room */
  @OnEvent('outbound.retry_queued')
  async onRetryQueued(payload: { messageId: string; enquiryId: string }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.OUTBOUND_RETRY_QUEUED, { messageId: payload.messageId, enquiryId: payload.enquiryId });
  }

  /** Delivery webhook arrived — emit updated status to contact room */
  @OnEvent('outbound.delivery_updated')
  async onDeliveryUpdated(payload: {
    messageId: string;
    enquiryId: string;
    deliveryStatus: string;
    deliveredAt?: Date;
    readAt?: Date;
  }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.OUTBOUND_DELIVERY_UPDATED, payload);
  }

  // ─── MESSAGE MUTATIONS ───────────────────────────────────────────────────

  /** Reaction added or removed — broadcast updated reaction summary */
  @OnEvent('message.reaction_updated')
  async onReactionUpdated(payload: {
    messageId: string;
    enquiryId: string;
    reactions: { emoji: string; count: number }[];
  }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, payload);
  }

  /** Message soft-deleted — hide from UI + refresh sidebar preview to previous message */
  @OnEvent('message.deleted')
  async onMessageDeleted(payload: { messageId: string; enquiryId: string }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.MESSAGE_DELETED, payload);
    await this.broadcastConversationDelta(contactId, 'MESSAGE_DELETED');
  }

  /** Message content edited — update in UI */
  @OnEvent('message.edited')
  async onMessageEdited(payload: {
    messageId: string;
    enquiryId: string;
    content: string;
    editedAt: Date;
  }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.MESSAGE_EDITED, payload);
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  /** Fetches contactId from enquiryId — single fast PK lookup */
  private async resolveContactId(enquiryId: string): Promise<string | null> {
    try {
      const e = await this.prisma.enquiry.findUnique({
        where: { id: enquiryId },
        select: { contactId: true },
      });
      return e?.contactId ?? null;
    } catch {
      this.logger.warn(`Failed to resolve contactId for enquiry ${enquiryId}`);
      return null;
    }
  }

  /**
   * Emits a sidebar patch (last-message preview + read state) to all connected agents.
   * Clients patch their local card and debounce re-sort — no full list refetch.
   * Keyed by contactId, not enquiryId: the card represents the CONTACT's thread, which
   * can span multiple enquiries — see getContactSummary(), the single source of truth
   * for this data (replaces this function's old per-enquiry inline fetch).
   */
  private async broadcastConversationDelta(
    contactId: string,
    updatedField: 'NEW_INBOUND' | 'OUTBOUND_SENT' | 'MESSAGE_DELETED',
  ) {
    try {
      const summary = await this.conversationService.getContactSummary(contactId);
      if (!summary) return;
      this.gateway.server.emit(SOCKET_EVENTS.CONVERSATION_UPDATED, {
        contactId,
        ...summary,
        updatedField,
      });
      await this.broadcastUnreadSummary();
    } catch (err: any) {
      this.logger.error(`Failed to broadcast conversation delta for contact ${contactId}: ${err.message}`);
    }
  }

  /**
   * Emits a full ConversationPreview card for a brand-new contact conversation so all
   * sidebars insert it at the top. Only called on first enquiry creation for a contact —
   * not for subsequent messages. Message/read state comes from getContactSummary();
   * enquiryId is passed straight through from the event that triggered this (the enquiry
   * that was just created — unambiguous, unlike broadcastConversationDelta where a
   * contact's "current" enquiry can't be inferred from a bare message event).
   */
  private async broadcastConversationNew(contactId: string, enquiryId: string) {
    try {
      const [contact, summary] = await Promise.all([
        this.prisma.contact.findUnique({
          where: { id: contactId },
          select: {
            displayName: true,
            organization: true,
            channels: {
              select: { channel: true, identifier: true, isPrimary: true },
              orderBy: { isPrimary: 'desc' },
              take: 1,
            },
          },
        }),
        this.conversationService.getContactSummary(contactId),
      ]);
      if (!contact || !summary) return;
      this.gateway.server.emit(SOCKET_EVENTS.CONVERSATION_NEW, {
        contactId,
        contactName:  contact.displayName,
        organization: contact.organization,
        channel:      contact.channels[0]?.channel ?? null,
        identifier:   contact.channels[0]?.identifier ?? null,
        enquiryId,
        ...summary,
      });
      await this.broadcastUnreadSummary();
    } catch (err: any) {
      this.logger.error(`Failed to broadcast new conversation for contact ${contactId}: ${err.message}`);
    }
  }

  /** Recomputes and globally broadcasts the per-channel unread-contact-count summary. */
  private async broadcastUnreadSummary(): Promise<void> {
    const summary = await this.conversationService.getUnreadSummary();
    this.gateway.server.emit(SOCKET_EVENTS.UNREAD_SUMMARY, summary);
  }

  // ─── INTERNAL TEAM CHAT ACTIONS ──────────────────────────────────────────

  @OnEvent('chat.message.pinned')
  onChatMessagePinned(payload: { conversationId: string; messageId: string; isPinned: boolean }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, payload);
  }

  @OnEvent('chat.message.starred')
  onChatMessageStarred(payload: { conversationId: string; messageId: string; isStarred: boolean }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_STARRED, payload);
  }

  @OnEvent('chat.message.edited')
  onChatMessageEdited(payload: { conversationId: string; messageId: string; content: string; editedAt: string }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_EDITED, payload);
  }

  @OnEvent('chat.message.deleted')
  onChatMessageDeleted(payload: { conversationId: string; messageId: string; isDeleted: boolean }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, payload);
  }

  /** Reaction toggled — everyone with the room open updates that message's chips. */
  @OnEvent('chat.message.reacted')
  onChatMessageReacted(payload: {
    conversationId: string;
    messageId: string;
    userId: string;
    emoji: string;
    added: boolean;
  }) {
    this.gateway.server
      .to(ROOMS.chat(payload.conversationId))
      .emit(SOCKET_EVENTS.CHAT_MESSAGE_REACTED, payload);
  }

  /**
   * Conversation changed (created / renamed / archived / members changed) —
   * tell each MEMBER's sidebar to refresh. Targeted at user rooms, never global.
   */
  @OnEvent('chat.conversation.updated')
  onChatConversationUpdated(payload: { conversationId: string; memberIds: string[] }) {
    for (const memberId of payload.memberIds) {
      this.gateway.server
        .to(ROOMS.user(memberId))
        .emit(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, { conversationId: payload.conversationId });
    }
  }

  /**
   * LIVE KICK — a member was removed (or left). Two steps, instant:
   * 1. Tell their client (all tabs) so the UI routes away + drops the channel.
   * 2. Force every one of their sockets OUT of the conversation room — after
   *    this line no live event from that room can reach them again.
   */
  @OnEvent('chat.membership.removed')
  onChatMembershipRemoved(payload: { conversationId: string; userId: string }) {
    this.gateway.server
      .to(ROOMS.user(payload.userId))
      .emit(SOCKET_EVENTS.CHAT_MEMBERSHIP_REMOVED, { conversationId: payload.conversationId });

    this.gateway.server
      .in(ROOMS.user(payload.userId))
      .socketsLeave(ROOMS.chat(payload.conversationId));
  }

  @OnEvent('message.star.toggled')
  onMessageStarToggled(payload: { contactId: string; messageId: string; isStarred: boolean }) {
    this.gateway.server
      .to(ROOMS.contact(payload.contactId))
      .emit(SOCKET_EVENTS.MESSAGE_STAR_TOGGLED, payload);
  }
}
