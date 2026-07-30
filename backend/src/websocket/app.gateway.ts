// app.gateway.ts — SINGLE SOURCE OF TRUTH for all WebSocket events (see registry below).

/**
 * =====================================================
 * SOCKET EVENT REGISTRY — Single source of truth
 * =====================================================
 * ALL @SubscribeMessage handlers live in this file.
 * ALL server.to().emit() calls originate from this file.
 * Business logic lives in injected services.
 *
 * INBOUND (client → server):
 *   - contact:join        → joins contact room
 *   - contact:leave       → leaves contact room
 *   - outbound:send       → queues outbound message (Step 5)
 *   - draft:typing        → broadcasts typing indicator (renamed in Step 11, kept as typing:start/stop for now)
 *   - typing:start        → broadcasts typing indicator (legacy name — renamed to draft:typing in Step 11)
 *   - typing:stop         → stops typing indicator (legacy name — renamed in Step 11)
 *
 * OUTBOUND (server → client) — all emitted from AppEventHandler via this.server:
 *   - chat:new-message         → new inbound message (renamed to message:new in Step 10)
 *   - notification:new-message → global notification badge
 *   - outbound:sent            → agent sent message (to others in room)
 *   - outbound:status          → delivery status changed (Step 5+)
 *   - outbound:failed          → delivery permanently failed
 *   - outbound:retry_queued    → message re-queued
 *   - outbound:delivery_updated → DELIVERED/READ webhook
 *   - typing:update            → someone is typing (renamed to draft:composing in Step 11)
 *   - message:reaction_updated → reaction changed
 *   - message:deleted          → message soft deleted
 *   - message:edited           → message edited
 *   - contact-list:update      → sidebar refresh (renamed to contact:updated in Step 12)
 *   - presence:online          → user came online
 *   - presence:offline         → user went offline
 * =====================================================
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { HttpException, Logger, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/database/prisma.service';
import { ROOMS, SOCKET_EVENTS } from 'src/common/constants/socket-events';
import { OutboundSendService } from '../modules/outbound/outbound-send.service';
import { ChatService } from '../modules/chat/chat.service';
import { MessageChannel } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { requireEnv } from 'src/common/utils/require-env';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    role: string;
    userName?: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);
  private readonly jwtSecret = requireEnv('JWT_SECRET');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly outboundSendService?: OutboundSendService,
    @Optional() private readonly chatService?: ChatService,
  ) {}

  // ─── CONNECTION LIFECYCLE ─────────────────────────────────────────────────

  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        client.emit('auth-error', { message: 'No token provided' });
        client.disconnect(true);
        return;
      }
      const payload = jwt.verify(token as string, this.jwtSecret) as { sub: string; role: string };
      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Personal room: lets the server reach THIS user across all their tabs
      // (membership-scoped chat notifications, live kick) — no socket map needed.
      client.join(ROOMS.user(payload.sub));

      this.logger.log(`🔌 Connected: ${client.id} user=${payload.sub}`);

      // Query and cache userName during connection setup to avoid DB calls on high-frequency events like typing
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { displayName: true, userName: true },
      }).then(user => {
        if (user) {
          client.data.userName = user.displayName || user.userName;
        }
      }).catch((err: Error) => {
        this.logger.warn(`Failed to load display name for user ${payload.sub}: ${err.message}`);
      });

      this.prisma.userPresence.upsert({
        where: { userId: payload.sub },
        create: { userId: payload.sub, isOnline: true },
        update: { isOnline: true, lastSeenAt: new Date() },
      }).catch((err: Error) => {
        this.logger.warn(`Failed to mark user ${payload.sub} online: ${err.message}`);
      });

      this.server.emit(SOCKET_EVENTS.PRESENCE_ONLINE, { userId: payload.sub });
    } catch (err: any) {
      this.logger.warn(`🚫 Invalid token — disconnecting ${client.id}: ${err.message}`);
      client.emit('auth-error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`🔌 Disconnected: ${client.id}`);
    if (client.data?.userId) {
      this.prisma.userPresence.upsert({
        where: { userId: client.data.userId },
        create: { userId: client.data.userId, isOnline: false },
        update: { isOnline: false, lastSeenAt: new Date() },
      }).catch((err: Error) => {
        this.logger.warn(`Failed to mark user ${client.data.userId} offline: ${err.message}`);
      });
      this.server.emit(SOCKET_EVENTS.PRESENCE_OFFLINE, { userId: client.data.userId });
    }
  }

  // ─── ROOM MANAGEMENT ─────────────────────────────────────────────────────

  /** Joins the contact room — all events for this contact are scoped here */
  @SubscribeMessage(SOCKET_EVENTS.CONTACT_JOIN)
  handleContactJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { contactId: string },
  ) {
    if (!client.data?.userId) return { status: 'error', message: 'Not authenticated' };
    const room = ROOMS.contact(data.contactId);
    client.join(room);
    this.logger.log(`👁️ User ${client.data.userId} joined room ${room}`);
    console.log("data checking", room )
    console.log('contact_id',data.contactId )
    return { status: 'joined', room };
  }

  /** Leaves the contact room */
  @SubscribeMessage(SOCKET_EVENTS.CONTACT_LEAVE)
  handleContactLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { contactId: string },
  ) {
    const room = ROOMS.contact(data.contactId);
    client.leave(room);
    this.logger.log(`👁️ User ${client.data?.userId} left room ${room}`);
    return { status: 'left', room };
  }

  // ─── TYPING INDICATORS ───────────────────────────────────────────────────

  /** Broadcasts typing indicator to contact room and globally (excludes sender) */
  @SubscribeMessage(SOCKET_EVENTS.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId?: string; contactId?: string },
  ) {
    const contactId = data.contactId;
    if (!contactId) return;
    const userName = client.data.userName || 'Someone';

    // Broadcast to specific contact room (excluding sender)
    client.to(ROOMS.contact(contactId)).emit(SOCKET_EVENTS.TYPING_UPDATE, {
      contactId,
      userId: client.data.userId,
      userName,
      isTyping: true,
    });

    // Broadcast globally to all sidebars (excluding sender)
    client.broadcast.emit(SOCKET_EVENTS.CONVERSATION_TYPING, {
      contactId,
      userId: client.data.userId,
      userName,
      isTyping: true,
    });
  }

  /** Clears typing indicator in contact room and globally (excludes sender) */
  @SubscribeMessage(SOCKET_EVENTS.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId?: string; contactId?: string },
  ) {
    const contactId = data.contactId;
    if (!contactId) return;

    // Broadcast to specific contact room (excluding sender)
    client.to(ROOMS.contact(contactId)).emit(SOCKET_EVENTS.TYPING_UPDATE, {
      contactId,
      userId: client.data.userId,
      isTyping: false,
    });

    // Broadcast globally to all sidebars (excluding sender)
    client.broadcast.emit(SOCKET_EVENTS.CONVERSATION_TYPING, {
      contactId,
      userId: client.data.userId,
      isTyping: false,
    });
  }

  // ─── INTERNAL TEAM CHAT ──────────────────────────────────────────────────

  /**
   * Joins an internal chat conversation room — MEMBERS ONLY.
   * Membership is the single access source: a non-member's join is silently
   * refused, so they can never receive that room's live events.
   */
  @SubscribeMessage(SOCKET_EVENTS.CHAT_JOIN)
  async handleChatJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.data?.userId) return { status: 'error', message: 'Not authenticated' };
    if (!data?.conversationId) return { status: 'error', message: 'No conversationId' };

    const isMember = await this.chatService?.isActiveMember(data.conversationId, client.data.userId);
    if (!isMember) {
      this.logger.warn(`💬 chat:join refused — ${client.data.userId} is not a member of ${data.conversationId}`);
      return { status: 'error', message: 'Not a member of this conversation' };
    }

    const room = ROOMS.chat(data.conversationId);
    client.join(room);
    this.logger.log(`💬 User ${client.data.userId} joined chat room ${room}`);
    return { status: 'joined', room };
  }

  /** Leaves an internal chat conversation room. */
  @SubscribeMessage(SOCKET_EVENTS.CHAT_LEAVE)
  handleChatLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId) return { status: 'error', message: 'No conversationId' };
    const room = ROOMS.chat(data.conversationId);
    client.leave(room);
    this.logger.log(`💬 User ${client.data?.userId} left chat room ${room}`);
    return { status: 'left', room };
  }

  /** Recipient's device received messages → advance their delivered watermark. */
  @SubscribeMessage(SOCKET_EVENTS.CHAT_DELIVERED)
  async handleChatDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.data?.userId || !data?.conversationId || !this.chatService) return;
    try {
      await this.chatService.markDelivered(data.conversationId, client.data.userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`chat:delivered failed for user ${client.data.userId}: ${message}`);
    }
  }

  /** Recipient is viewing the room → advance their read (and delivered) watermark. */
  @SubscribeMessage(SOCKET_EVENTS.CHAT_READ)
  async handleChatRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.data?.userId || !data?.conversationId || !this.chatService) return;
    try {
      await this.chatService.markRead(data.conversationId, client.data.userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`chat:read failed for user ${client.data.userId}: ${message}`);
    }
  }

  // ─── SEND ────────────────────────────────────────────────────────────────

  /**
   * Queues an outbound message, broadcasts to other agents, and returns an ack to the sender.
   */
  @SubscribeMessage(SOCKET_EVENTS.OUTBOUND_SEND)
  async handleOutboundSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      enquiryId: string;
      channel?: MessageChannel;
      subject?: string;
      body?: string;
      draftId?: string;
      recipientOverride?: string;
      tempId?: string;
    },
  ) {
    if (!client.data?.userId) return { success: false, tempId: data.tempId, error: 'Not authenticated' };
    if (!this.outboundSendService) return { success: false, tempId: data.tempId, error: 'Send service unavailable' };

    try {
      const result = await this.outboundSendService.send({
        enquiryId: data.enquiryId,
        channel: data.channel,
        subject: data.subject,
        body: data.body,
        draftId: data.draftId,
        recipientOverride: data.recipientOverride,
        userId: client.data.userId,
      });

      // Load the fully constructed ConversationMessage with relation objects to broadcast
      const message = await this.prisma.conversationMessage.findUnique({
        where: { id: result.messageId },
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
      });

      if (message) {
        // Broadcast MESSAGE_NEW to OTHER agents in the contact room (excludes the sender)
        client.to(ROOMS.contact(result.contactId)).emit(SOCKET_EVENTS.MESSAGE_NEW, {
          contactId: result.contactId,
          enquiryId: data.enquiryId,
          message,
        });
      }

      // Broadcast CONVERSATION_UPDATED globally to update all sidebars
      this.server.emit(SOCKET_EVENTS.CONVERSATION_UPDATED, {
        enquiryId: data.enquiryId,
        contactId: result.contactId,
        lastMessagePreview: data.body ? data.body.substring(0, 80) : 'New attachment',
        lastActivityAt: message ? message.createdAt.toISOString() : new Date().toISOString(),
        status: 'OPEN', // Default to active status
        unreadDelta: 0,
        updatedField: 'OUTBOUND_SENT',
      });

      return {
        success: true,
        messageId: result.messageId,
        tempId: data.tempId,
        jobId: result.jobId,
        status: 'PENDING',
      };
    } catch (err: any) {
      this.logger.error(`outbound:send failed for user ${client.data.userId}: ${err.message}`);
      // HttpException (BadRequestException, ForbiddenException, etc.) is deliberately client-facing
      // — those messages are safe to show as-is. Anything else is unexpected internals; the client
      // gets a generic message, the real one stays in the log above (mirrors GlobalExceptionFilter's
      // HTTP-side behavior for this same distinction).
      const clientMessage = err instanceof HttpException ? err.message : 'Send failed. Please try again.';
      return {
        success: false,
        tempId: data.tempId,
        error: clientMessage,
      };
    }
  }
}
