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
import { PrismaService } from '../database/prisma.service';
import { ROOMS, SOCKET_EVENTS } from '../common/constants/socket-events';

@Injectable()
export class AppEventHandler {
  private readonly logger = new Logger(AppEventHandler.name);

  constructor(
    private readonly gateway: AppGateway,
    private readonly conversationService: ConversationService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── INBOUND MESSAGES ────────────────────────────────────────────────────

  /** Fast path: message appended to existing enquiry — push to chat + global notification + sidebar */
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

    await this.broadcastContactListUpdate();
  }

  /** Slow path: new enquiry created after qualification — broadcast sidebar update */
  @OnEvent('enquiry.created')
  async onNewEnquiry(payload: { contactId: string; enquiryId: string }) {
    this.logger.log(`📡 New enquiry ${payload.enquiryId} for contact ${payload.contactId}`);

    this.gateway.server.emit(SOCKET_EVENTS.NOTIFICATION_NEW_MESSAGE, {
      contactId: payload.contactId,
      enquiryId: payload.enquiryId,
      messagePreview: 'New enquiry created',
      messageId: `enq-${payload.enquiryId}`,
    });

    await this.broadcastContactListUpdate();
  }

  // ─── OUTBOUND DELIVERY STATUS ────────────────────────────────────────────

  /** Provider accepted the message — emit SENT status to contact room */
  @OnEvent('outbound.sent')
  async onOutboundSent(payload: { messageId: string; enquiryId: string; sentAt: Date }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.OUTBOUND_SENT, { messageId: payload.messageId, enquiryId: payload.enquiryId, sentAt: payload.sentAt });
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

  /** Message soft-deleted — hide from UI */
  @OnEvent('message.deleted')
  async onMessageDeleted(payload: { messageId: string; enquiryId: string }) {
    const contactId = await this.resolveContactId(payload.enquiryId);
    if (!contactId) return;
    this.gateway.server
      .to(ROOMS.contact(contactId))
      .emit(SOCKET_EVENTS.MESSAGE_DELETED, payload);
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

  /** Fetches current contact list and broadcasts to all connected agents */
  private async broadcastContactListUpdate() {
    try {
      const result = await this.conversationService.listConversations({ limit: 50 });
      this.gateway.server.emit(SOCKET_EVENTS.CONTACT_LIST_UPDATE, { conversations: result.data });
      this.logger.log(`📡 Broadcasted contact-list:update (${result.data.length} contacts)`);
    } catch (err: any) {
      this.logger.error(`Failed to broadcast contact list: ${err.message}`);
    }
  }
}
