import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, Inject, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'src/database/prisma.service';
import * as jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    role: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class OutboundGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OutboundGateway.name);
  private readonly jwtSeceret = process.env.JWT_SECERET || 'dev-secret';

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        client.emit('auth-error', { message: 'No token provided' });
        client.disconnect(true);
        return;
      }
      const payload = jwt.verify(token as string, this.jwtSeceret) as { sub: string; role: string };
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      this.logger.log(`🔌 Connected: ${client.id} user=${payload.sub}`);

      // Mark online
      this.prisma?.userPresence.upsert({
        where: { userId: payload.sub },
        create: { userId: payload.sub, isOnline: true },
        update: { isOnline: true, lastSeenAt: new Date() },
      }).catch(() => {});
      this.server.emit('presence:online', { userId: payload.sub });
    } catch (err) {
      this.logger.warn(`🚫 Invalid token — disconnecting ${client.id}: ${err.message}`);
      client.emit('auth-error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`🔌 Disconnected: ${client.id}`);
    if (client.data?.userId) {
      this.prisma?.userPresence.upsert({
        where: { userId: client.data.userId },
        create: { userId: client.data.userId, isOnline: false },
        update: { isOnline: false, lastSeenAt: new Date() },
      }).catch(() => {});
      this.server.emit('presence:offline', { userId: client.data.userId });
    }
  }

  // ── Room management ──

  @SubscribeMessage('enquiry:join')
  handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId: string },
  ) {
    if (!client.data?.userId) {
      return { status: 'error', message: 'Not authenticated' };
    }
    const room = `enquiry:${data.enquiryId}`;
    client.join(room);
    this.logger.log(`👁️ User ${client.data.userId} joined room ${room}`);
    return { status: 'joined', room };
  }

  @SubscribeMessage('enquiry:leave')
  handleLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId: string },
  ) {
    const room = `enquiry:${data.enquiryId}`;
    client.leave(room);
    this.logger.log(`👁️ User ${client.data?.userId} left room ${room}`);
    return { status: 'left', room };
  }

  // ── Typing indicators ──

  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId: string },
  ) {
    client.to(`enquiry:${data.enquiryId}`).emit('typing:update', {
      userId: client.data.userId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { enquiryId: string },
  ) {
    client.to(`enquiry:${data.enquiryId}`).emit('typing:update', {
      userId: client.data.userId,
      isTyping: false,
    });
  }

  // ── Internal event → socket broadcast ──

  @OnEvent('outbound.draft_saved')
  onDraftSaved(payload: { enquiryId: string; draftId: string; updatedAt: Date }) {
    this.server
      .to(`enquiry:${payload.enquiryId}`)
      .emit('outbound:draft_saved', payload);
  }

  @OnEvent('outbound.sent')
  onSent(payload: { messageId: string; enquiryId: string; sentAt: Date }) {
    this.server
      .to(`enquiry:${payload.enquiryId}`)
      .emit('outbound:sent', payload);
  }

  @OnEvent('outbound.failed')
  onFailed(payload: { messageId: string; enquiryId: string; error?: string; attemptCount: number }) {
    this.server
      .to(`enquiry:${payload.enquiryId}`)
      .emit('outbound:failed', payload);
  }

  @OnEvent('outbound.retry_queued')
  onRetryQueued(payload: { messageId: string; enquiryId: string }) {
    this.server
      .to(`enquiry:${payload.enquiryId}`)
      .emit('outbound:retry_queued', payload);
  }

  @OnEvent('outbound.delivery_updated')
  onDeliveryUpdated(payload: {
    messageId: string;
    enquiryId: string;
    deliveryStatus: string;
    deliveredAt?: Date;
    readAt?: Date;
  }) {
    this.server
      .to(`enquiry:${payload.enquiryId}`)
      .emit('outbound:delivery_updated', payload);
  }

  @OnEvent('message.reaction_updated')
  onReactionUpdated(payload: { messageId: string; enquiryId: string; reactions: { emoji: string; count: number }[] }) {
    this.server.to(`enquiry:${payload.enquiryId}`).emit('message:reaction_updated', payload);
  }

  @OnEvent('message.deleted')
  onMessageDeleted(payload: { messageId: string; enquiryId: string }) {
    this.server.to(`enquiry:${payload.enquiryId}`).emit('message:deleted', payload);
  }

  @OnEvent('message.edited')
  onMessageEdited(payload: { messageId: string; enquiryId: string; content: string; editedAt: Date }) {
    this.server.to(`enquiry:${payload.enquiryId}`).emit('message:edited', payload);
  }

  @OnEvent('outbound.attachment_added')
  onAttachmentAdded(payload: { draftId: string; enquiryId: string; attachment: object }) {
    this.server.to(`enquiry:${payload.enquiryId}`).emit('outbound:attachment_added', payload);
  }
}
