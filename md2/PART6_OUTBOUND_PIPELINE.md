# 📡 Part 6: Outbound Pipeline — Actually Sending Messages

> When staff clicks "Reply", the message must actually reach the customer via WhatsApp/Email. This module handles channel routing, provider integration, and delivery tracking.

---

## What This Module Does

```
Staff clicks "Send" on an enquiry reply
         ↓
  EnquiryService creates ConversationMessage (status: PENDING)
         ↓
  EventEmitter: 'message.outbound'
         ↓
  OutboundService picks up the event
         ↓
  ┌── Channel Router ──────────────────────────┐
  │  Which adapter to use?                      │
  │  WHATSAPP → WhatsAppAdapter                │
  │  EMAIL → EmailAdapter                       │
  │  SMS → SmsAdapter (future)                  │
  └─────────────────────────────────────────────┘
         ↓
  Adapter calls external API (WhatsApp Business API / SendGrid)
         ↓
  Response: externalId = "wamid_xyz789"
         ↓
  Update ConversationMessage: deliveryStatus = SENT, externalId = "wamid_xyz789"
         ↓
  (Later) Webhook callback: status = DELIVERED → READ
         ↓
  Update ConversationMessage: deliveryStatus = DELIVERED / READ
```

---

## File Structure

```
src/modules/outbound/
├── outbound.module.ts
├── outbound.service.ts
├── channel-router.service.ts
├── adapters/
│   ├── channel-adapter.interface.ts
│   ├── whatsapp.adapter.ts
│   └── email.adapter.ts
└── delivery/
    └── delivery-tracking.service.ts
```

---

## `src/modules/outbound/adapters/channel-adapter.interface.ts`

```typescript
import { MessageChannel } from '@prisma/client';

/**
 * WHAT: Every channel (WhatsApp, Email, SMS) implements this interface.
 * WHY:  The outbound service doesn't need to know HOW to send a message.
 *       It just calls adapter.send() and the adapter handles the specifics.
 *       This makes adding new channels trivial: just create a new adapter.
 *
 * PATTERN: Strategy pattern — swap implementations without changing the caller.
 */
export interface SendParams {
  to: string;        // recipient (phone number or email address)
  content: string;   // message body
  subject?: string;  // for email only
  replyTo?: string;  // for email threading (In-Reply-To header)
}

export interface SendResult {
  success: boolean;
  externalId?: string;  // Provider's message ID for tracking
  error?: string;       // Error message if failed
}

export interface ChannelAdapter {
  readonly channel: MessageChannel;

  /**
   * Send a message via this channel.
   * Returns the provider's message ID on success.
   */
  send(params: SendParams): Promise<SendResult>;

  /**
   * Check if this adapter is properly configured and ready to send.
   */
  isConfigured(): boolean;
}
```

---

## `src/modules/outbound/adapters/whatsapp.adapter.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './channel-adapter.interface';

/**
 * Sends messages via WhatsApp Business Cloud API.
 *
 * PREREQUISITE:
 *   - Meta Business account with WhatsApp Business API access
 *   - WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env
 *   - The recipient must have messaged you first (WhatsApp 24h window)
 *     OR you use a pre-approved message template
 *
 * API: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.WHATSAPP;
  private readonly logger = new Logger(WhatsAppAdapter.name);

  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(private config: ConfigService) {
    this.apiUrl = this.config.get('WHATSAPP_API_URL', 'https://graph.facebook.com/v18.0');
    this.phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', '');
    this.accessToken = this.config.get('WHATSAPP_ACCESS_TOKEN', '');
  }

  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.isConfigured()) {
      this.logger.warn('WhatsApp adapter not configured — skipping send');
      return { success: false, error: 'WhatsApp not configured' };
    }

    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to.replace(/\D/g, ''), // Strip non-digits
          type: 'text',
          text: { body: params.content },
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        const errorMsg = data?.error?.message || `HTTP ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const externalId = data?.messages?.[0]?.id;
      this.logger.log(`📱 WhatsApp message sent: ${externalId} → ${params.to}`);

      return { success: true, externalId };
    } catch (error) {
      this.logger.error(`WhatsApp send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
```

---

## `src/modules/outbound/adapters/email.adapter.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './channel-adapter.interface';

/**
 * Sends emails via SendGrid API.
 *
 * ALTERNATIVE PROVIDERS: You can swap this for AWS SES, Mailgun,
 * or plain SMTP by creating a new adapter implementing ChannelAdapter.
 *
 * API: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.EMAIL;
  private readonly logger = new Logger(EmailAdapter.name);

  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('SENDGRID_API_KEY', '');
    this.fromEmail = this.config.get('SENDGRID_FROM_EMAIL', 'noreply@company.com');
    this.fromName = this.config.get('SENDGRID_FROM_NAME', 'Company');
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (!this.isConfigured()) {
      this.logger.warn('Email adapter not configured — skipping send');
      return { success: false, error: 'Email not configured' };
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.to }] }],
          from: { email: this.fromEmail, name: this.fromName },
          subject: params.subject || 'Re: Your Enquiry',
          content: [
            {
              type: 'text/plain',
              value: params.content,
            },
          ],
          // Email threading: In-Reply-To header
          headers: params.replyTo
            ? { 'In-Reply-To': params.replyTo, 'References': params.replyTo }
            : undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Sendgrid send failed: ${response.status} — ${errorText}`);
        return { success: false, error: `SendGrid error: ${response.status}` };
      }

      // SendGrid returns the message ID in the x-message-id header
      const externalId = response.headers.get('x-message-id') || `sg-${Date.now()}`;
      this.logger.log(`📧 Email sent: ${externalId} → ${params.to}`);

      return { success: true, externalId };
    } catch (error) {
      this.logger.error(`Email send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
```

---

## `src/modules/outbound/channel-router.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';

/**
 * Routes outbound messages to the correct channel adapter.
 *
 * WHY THIS EXISTS:
 *   The caller says: "Send this message via WHATSAPP to +91-9876..."
 *   This service finds the right adapter and calls it.
 *   If the adapter isn't configured, it falls back to another channel.
 */
@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly adapters: Map<MessageChannel, ChannelAdapter>;

  constructor(
    private whatsappAdapter: WhatsAppAdapter,
    private emailAdapter: EmailAdapter,
  ) {
    this.adapters = new Map();
    this.adapters.set(MessageChannel.WHATSAPP, whatsappAdapter);
    this.adapters.set(MessageChannel.EMAIL, emailAdapter);
  }

  async send(
    channel: MessageChannel,
    params: SendParams,
  ): Promise<SendResult> {
    const adapter = this.adapters.get(channel);

    if (!adapter) {
      this.logger.warn(`No adapter for channel: ${channel}`);
      return { success: false, error: `No adapter for ${channel}` };
    }

    if (!adapter.isConfigured()) {
      this.logger.warn(`${channel} adapter not configured — attempting fallback`);
      return this.sendWithFallback(channel, params);
    }

    return adapter.send(params);
  }

  /**
   * If the primary channel isn't configured, try alternatives.
   * e.g., WhatsApp not configured → try Email.
   */
  private async sendWithFallback(
    failedChannel: MessageChannel,
    params: SendParams,
  ): Promise<SendResult> {
    const fallbackOrder: MessageChannel[] = [
      MessageChannel.WHATSAPP,
      MessageChannel.EMAIL,
      MessageChannel.SMS,
    ].filter((c) => c !== failedChannel);

    for (const channel of fallbackOrder) {
      const adapter = this.adapters.get(channel);
      if (adapter?.isConfigured()) {
        this.logger.log(`Falling back to ${channel} for delivery`);
        return adapter.send(params);
      }
    }

    return { success: false, error: 'No configured channel adapters available' };
  }

  /**
   * Check which channels are currently available for sending.
   */
  getAvailableChannels(): MessageChannel[] {
    const available: MessageChannel[] = [];
    for (const [channel, adapter] of this.adapters) {
      if (adapter.isConfigured()) available.push(channel);
    }
    return available;
  }
}
```

---

## `src/modules/outbound/outbound.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelRouterService } from './channel-router.service';
import { MessageChannel, DeliveryStatus } from '@prisma/client';

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private prisma: PrismaService,
    private channelRouter: ChannelRouterService,
  ) {}

  /**
   * LISTENER: When EnquiryService creates an outbound ConversationMessage,
   * this event fires to actually SEND it via the channel adapter.
   */
  @OnEvent('message.outbound')
  async handleOutbound(payload: {
    messageId: string;
    enquiryId: string;
    channel: MessageChannel;
    to: string;
    content: string;
    subject?: string;
  }): Promise<void> {
    const { messageId, channel, to, content, subject } = payload;

    if (!to) {
      this.logger.error(`No recipient for message ${messageId} — cannot send`);
      await this.updateDeliveryStatus(messageId, DeliveryStatus.FAILED);
      return;
    }

    this.logger.log(`📤 Sending ${channel} message ${messageId} → ${to}`);

    const result = await this.channelRouter.send(channel, {
      to,
      content,
      subject,
    });

    if (result.success) {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          externalId: result.externalId,
        },
      });
      this.logger.log(`✅ Message ${messageId} sent. ExternalId: ${result.externalId}`);
    } else {
      await this.prisma.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });
      this.logger.error(`❌ Message ${messageId} failed: ${result.error}`);
    }
  }

  /**
   * Update delivery status from webhook callbacks.
   * Called when WhatsApp/SendGrid sends us a delivery receipt.
   */
  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
  ): Promise<void> {
    const data: any = { deliveryStatus: status };

    if (status === DeliveryStatus.DELIVERED) {
      data.deliveredAt = new Date();
    }
    if (status === DeliveryStatus.READ) {
      data.readAt = new Date();
    }

    await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data,
    });
  }

  /**
   * Update delivery status by externalId (from webhook callbacks).
   * Since webhooks give us the provider's message ID, not ours,
   * we need to look up our message by externalId.
   */
  async updateDeliveryStatusByExternalId(
    externalId: string,
    status: DeliveryStatus,
  ): Promise<void> {
    const message = await this.prisma.conversationMessage.findFirst({
      where: { externalId },
    });

    if (!message) {
      this.logger.warn(`No message found with externalId: ${externalId}`);
      return;
    }

    await this.updateDeliveryStatus(message.id, status);
    this.logger.debug(`📬 Delivery update: ${externalId} → ${status}`);
  }
}
```

---

## `src/modules/outbound/delivery/delivery-tracking.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OutboundService } from '../outbound.service';
import { DeliveryStatus } from '@prisma/client';

/**
 * Processes delivery webhook callbacks from WhatsApp and Email providers.
 *
 * WHY SEPARATE FROM OUTBOUND SERVICE:
 *   The webhook controller calls this service.
 *   It handles the messy parsing of provider-specific payloads
 *   and delegates to OutboundService for DB updates.
 */
@Injectable()
export class DeliveryTrackingService {
  private readonly logger = new Logger(DeliveryTrackingService.name);

  constructor(private outboundService: OutboundService) {}

  /**
   * Handle WhatsApp delivery status webhook.
   *
   * WhatsApp sends these statuses:
   *   sent → delivered → read
   *   OR: sent → failed
   */
  async handleWhatsAppStatus(statusPayload: {
    id: string;       // The WhatsApp message ID (externalId)
    status: string;   // 'sent' | 'delivered' | 'read' | 'failed'
    timestamp: string;
    errors?: any[];
  }): Promise<void> {
    const { id, status } = statusPayload;

    const statusMap: Record<string, DeliveryStatus> = {
      sent: DeliveryStatus.SENT,
      delivered: DeliveryStatus.DELIVERED,
      read: DeliveryStatus.READ,
      failed: DeliveryStatus.FAILED,
    };

    const mappedStatus = statusMap[status];
    if (!mappedStatus) {
      this.logger.debug(`Unknown WhatsApp status: ${status}`);
      return;
    }

    await this.outboundService.updateDeliveryStatusByExternalId(id, mappedStatus);
    this.logger.log(`📱 WA delivery: ${id} → ${mappedStatus}`);
  }

  /**
   * Handle SendGrid email event webhook.
   *
   * SendGrid events: processed → delivered → open → click
   *                  OR: bounce → dropped
   */
  async handleEmailEvent(event: {
    sg_message_id: string;
    event: string;
    timestamp: number;
  }): Promise<void> {
    const statusMap: Record<string, DeliveryStatus> = {
      processed: DeliveryStatus.SENT,
      delivered: DeliveryStatus.DELIVERED,
      open: DeliveryStatus.READ,
      bounce: DeliveryStatus.FAILED,
      dropped: DeliveryStatus.FAILED,
    };

    const mappedStatus = statusMap[event.event];
    if (!mappedStatus) return;

    // SendGrid appends ".filter..." to message IDs, strip it
    const cleanId = event.sg_message_id?.split('.')[0];
    if (!cleanId) return;

    await this.outboundService.updateDeliveryStatusByExternalId(cleanId, mappedStatus);
    this.logger.log(`📧 Email event: ${cleanId} → ${mappedStatus}`);
  }
}
```

---

## `src/modules/outbound/outbound.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';
import { ChannelRouterService } from './channel-router.service';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { DeliveryTrackingService } from './delivery/delivery-tracking.service';

@Module({
  providers: [
    OutboundService,
    ChannelRouterService,
    WhatsAppAdapter,
    EmailAdapter,
    DeliveryTrackingService,
  ],
  exports: [OutboundService, DeliveryTrackingService, ChannelRouterService],
})
export class OutboundModule {}
```

---

**Continue to [Part 7: Automation & SLA →](./PART7_AUTOMATION_SLA.md)**
