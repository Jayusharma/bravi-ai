import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConversationService } from './messaging.service';
import { OnEvent } from '@nestjs/event-emitter';
import * as jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    role: string;
  }
}

/*=============================//authentication to the connection//==========================*/

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})

export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('MessagingGateway');
  private readonly jwtSeceret = process.env.JWT_SECERET || 'dev-secret';

  constructor(private conversationService: ConversationService) { }


  /*=================//connection happening via auth //===================*/

  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth.token || client.handshake.query.token;

      if (!token) {
        this.logger.warn(`🔌 No token provided for client: ${client.id}`);
        client.disconnect(true);
        return;
      }

      // 2. Verify JWT (same secret as REST API)
      const payload = jwt.verify(token, this.jwtSeceret) as {
        sub: string;
        role: string;
      };
      // 3. Attach user info to socket for future events
      client.data.userId = payload.sub;
      client.data.role = payload.role;

      this.logger.log(`🔌 Connected: ${client.id} with user ${payload.sub}`);

    }
    catch (err) {
      this.logger.warn(
        `🚫 Invalid token — disconnecting ${client.id}: ${err.message}`,
      );
      client.emit('auth-error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`🔌 Disconnected: ${client.id}`);
  }


  /*=================//connection for the messages //===================*/

  /**
   * FAST PATH: Message appended to existing enquiry
   * Broadcast sidebar update + chat message to room
   */
  @OnEvent('message.inbound.appended')
  async onInboundMessage(payload: {
    contactId: string;
    enquiryId: string;
    message: any;
  }) {
    this.logger.log(
      `📡 Inbound message for contact ${payload.contactId} — broadcasting`,
    );

    // 1. Chat view: send full message to users viewing this contact's chat
    this.server
      .to(`contact:${payload.contactId}`)
      .emit('chat:new-message', {
        contactId: payload.contactId,
        enquiryId: payload.enquiryId,
        message: payload.message,
      });

    // 2. Notification: send to ALL connected users (for badges + toasts)
    //    This is what makes the badge/toast work even when the chat isn't open
    this.server.emit('notification:new-message', {
      contactId: payload.contactId,
      enquiryId: payload.enquiryId,
      messagePreview: typeof payload.message?.content === 'string'
        ? payload.message.content.substring(0, 100)
        : 'New message',
      messageId: payload.message?.id,
    });

    // 3. Sidebar: refresh for ALL users
    await this.broadcastContactListUpdate();
  }

  /**
   * SLOW PATH: New enquiry created after qualification
   * Broadcast sidebar update (new contact appears)
   */
  @OnEvent('enquiry.created')
  async onNewEnquiry(payload: {
    contactId: string;
    enquiryId: string;
  }) {
    this.logger.log(
      `📡 New enquiry ${payload.enquiryId} for contact ${payload.contactId} — broadcasting`,
    );

    // Notify all users about the new enquiry
    this.server.emit('notification:new-message', {
      contactId: payload.contactId,
      enquiryId: payload.enquiryId,
      messagePreview: 'New enquiry created',
      messageId: `enq-${payload.enquiryId}`,
    });

    // Sidebar: refresh for ALL users (new contact appears)
    await this.broadcastContactListUpdate();
  }

  // ── Room management for Phase 2 ──

  @SubscribeMessage('chat:join')
  handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { contactId: string },
  ) {
    const room = `contact:${data.contactId}`;
    client.join(room);
    this.logger.log(
      `👁️ User ${client.data.userId} joined room ${room}`,
    );
    return { status: 'joined', room };
  }

  @SubscribeMessage('chat:leave')
  handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { contactId: string },
  ) {
    const room = `contact:${data.contactId}`;
    client.leave(room);
    this.logger.log(
      `👁️ User ${client.data.userId} left room ${room}`,
    );
    return { status: 'left', room };
  }

  // ── Helper: Fetch and broadcast fresh contact list ──

  private async broadcastContactListUpdate() {
    try {
      const result =
        await this.conversationService.listConversations({
          limit: 50,
        });
      this.server.emit('contact-list:update', {
        conversations: result.data,
      });
      this.logger.log(
        `📡 Broadcasted contact-list:update (${result.data.length} contacts)`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to broadcast contact list: ${err.message}`,
      );
    }
  }
}

