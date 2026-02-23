# 📡 Part 9: Inbound Channels — WhatsApp & Email Webhook Integration

> **This part makes your system actually receive real messages.**  
> WhatsApp messages and emails flow into your IngestionService through webhook adapters.

---

## Architecture Overview

```
WhatsApp Cloud API                         SendGrid Inbound Parse
(Meta sends POST)                          (SendGrid forwards email)
        │                                          │
        ▼                                          ▼
┌─────────────────────┐               ┌──────────────────────┐
│  WhatsApp Webhook    │               │  Email Webhook        │
│  Controller          │               │  Controller           │
│                      │               │                       │
│  1. Verify signature │               │  1. Parse multipart   │
│  2. Parse WA payload │               │  2. Extract fields    │
│  3. Build DTO        │               │  3. Build DTO         │
└──────────┬───────────┘               └──────────┬────────────┘
           │                                      │
           └──────────────┬───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  IngestionService     │
              │  .ingest(dto)         │
              │                       │
              │  Same flow for both:  │
              │  Contact → Check      │
              │  open enquiry →       │
              │  Append or Qualify    │
              └───────────────────────┘
```

---

## File Structure

```
src/modules/webhooks/
├── webhook.module.ts                    ← Module registration
├── controllers/
│   ├── whatsapp-webhook.controller.ts   ← WhatsApp Cloud API webhook
│   └── email-webhook.controller.ts      ← SendGrid Inbound Parse webhook
├── adapters/
│   ├── whatsapp.adapter.ts              ← Parses raw WA payload → DTO
│   └── email.adapter.ts                 ← Parses raw email payload → DTO
├── guards/
│   └── webhook-signature.guard.ts       ← Verifies webhook authenticity
└── dto/
    ├── whatsapp-webhook.dto.ts          ← WhatsApp payload types
    └── email-webhook.dto.ts             ← Email payload types
```

---

## Step 1: Environment Variables

Add to `.env`:

```env
# ── WhatsApp Cloud API ──
WHATSAPP_VERIFY_TOKEN=your-custom-verify-token-here     # You choose this (any random string)
WHATSAPP_APP_SECRET=your-facebook-app-secret             # From Meta Developer Dashboard
WHATSAPP_PHONE_NUMBER_ID=123456789012345                 # Your WA Business phone number ID
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx                         # Permanent access token

# ── SendGrid Inbound Parse ──
SENDGRID_INBOUND_WEBHOOK_SECRET=your-sendgrid-secret     # Optional: for signature verification
```

---

## Step 2: WhatsApp Cloud API — How It Works

### The Setup Process (Meta Developer Dashboard)

```
1. Go to https://developers.facebook.com
2. Create App → Business type → Add "WhatsApp" product
3. WhatsApp → Configuration → Webhooks
4. Set Callback URL: https://yourdomain.com/api/v1/webhook/whatsapp
5. Set Verify Token: (same as WHATSAPP_VERIFY_TOKEN in .env)
6. Subscribe to: messages, message_deliveries, message_reads
```

### WhatsApp sends TWO types of requests:

| Request | When | Purpose |
|---------|------|---------|
| `GET /webhook/whatsapp` | Once during setup | Verification challenge (proves you own the URL) |
| `POST /webhook/whatsapp` | Every time someone messages you | Actual me  ssage delivery |

---

## Step 3: WhatsApp Webhook DTO

```typescript
// src/modules/webhooks/dto/whatsapp-webhook.dto.ts

/**
 * WhatsApp Cloud API webhook payload structure.
 * 
 * Meta sends a complex nested JSON. The key data we need is:
 *   payload.entry[0].changes[0].value.messages[0]
 *
 * Full docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */

// The actual message inside the webhook
export interface WhatsAppMessage {
  from: string;        // Sender's phone number (e.g., "919876543210")
  id: string;          // WhatsApp message ID (e.g., "wamid.HBg...")
  timestamp: string;   // Unix timestamp
  type: string;        // "text", "image", "document", etc.
  text?: {
    body: string;      // The actual message text
  };
}

// Contact info that comes with the message
export interface WhatsAppContact {
  profile: {
    name: string;      // WhatsApp display name
  };
  wa_id: string;       // WhatsApp ID (usually same as phone number)
}

// Status updates (sent, delivered, read)
export interface WhatsAppStatus {
  id: string;          // Message ID
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
  }>;
}

// The full webhook payload from Meta
export interface WhatsAppWebhookPayload {
  object: string;      // Always "whatsapp_business_account"
  entry: Array<{
    id: string;        // WhatsApp Business Account ID
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;   // Your business phone number
          phone_number_id: string;        // Your phone number ID
        };
        contacts?: WhatsAppContact[];     // Present when message arrives
        messages?: WhatsAppMessage[];     // Present when message arrives
        statuses?: WhatsAppStatus[];      // Present for delivery updates
      };
      field: string;   // "messages"
    }>;
  }>;
}
```

---

## Step 4: WhatsApp Adapter

```typescript
// src/modules/webhooks/adapters/whatsapp.adapter.ts

import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppWebhookPayload, WhatsAppMessage, WhatsAppContact } from '../dto/whatsapp-webhook.dto';
import { IngestMessageDto } from '../../Ingestion/dto/incoming-message.dto';
import { MessageChannel } from '@prisma/client';

/**
 * Parses raw WhatsApp Cloud API webhook payloads into our IngestMessageDto.
 *
 * WHY A SEPARATE ADAPTER:
 *   - WhatsApp payload is deeply nested and complex
 *   - Isolates third-party format from our internal format
 *   - Easy to swap if WhatsApp changes their API
 *   - Testable independently
 */
@Injectable()
export class WhatsAppAdapter {
  private readonly logger = new Logger(WhatsAppAdapter.name);

  /**
   * Parse a WhatsApp webhook payload into IngestMessageDto(s).
   * 
   * Returns an ARRAY because one webhook payload can contain
   * multiple messages (rare but possible).
   */
  parseInbound(payload: WhatsAppWebhookPayload): IngestMessageDto[] {
    const messages: IngestMessageDto[] = [];

    if (!payload?.entry) return messages;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Skip if this isn't a message event (could be a status update)
        if (!value.messages || value.messages.length === 0) continue;

        // Get the business phone number (your number)
        const businessPhone = value.metadata?.display_phone_number;

        // Get contact info
        const contacts = value.contacts || [];

        for (const msg of value.messages) {
          // We only handle text messages for now
          // TODO: Add support for image, document, audio messages later
          if (msg.type !== 'text' || !msg.text?.body) {
            this.logger.debug(
              `Skipping non-text message type: ${msg.type} from ${msg.from}`,
            );
            continue;
          }

          // Find the matching contact for this message
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const senderName = contact?.profile?.name;

          // Format phone number with + prefix
          const phoneNumber = msg.from.startsWith('+')
            ? msg.from
            : `+${msg.from}`;

          messages.push({
            channel: MessageChannel.WHATSAPP,
            externalId: msg.id,                    // wamid.HBg... (unique per message)
            from: phoneNumber,                     // +919876543210
            to: businessPhone,                     // Your business number
            body: msg.text.body,                   // The actual text
            rawPayload: payload as any,            // Full payload for debugging
            // senderName is NOT in IngestMessageDto — we'll use AI to extract it
          });

          this.logger.log(
            `📱 Parsed WhatsApp message from ${senderName || phoneNumber}: "${msg.text.body.substring(0, 50)}..."`,
          );
        }
      }
    }

    return messages;
  }

  /**
   * Parse delivery status updates (sent, delivered, read).
   * Used to update ConversationMessage.deliveryStatus.
   */
  parseStatusUpdates(payload: WhatsAppWebhookPayload): Array<{
    externalId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: Date;
    errorCode?: number;
    errorMessage?: string;
  }> {
    const updates: Array<any> = [];

    if (!payload?.entry) return updates;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const statuses = change.value.statuses || [];
        for (const status of statuses) {
          updates.push({
            externalId: status.id,
            status: status.status,
            timestamp: new Date(parseInt(status.timestamp) * 1000),
            errorCode: status.errors?.[0]?.code,
            errorMessage: status.errors?.[0]?.title,
          });
        }
      }
    }

    return updates;
  }
}
```

---

## Step 5: WhatsApp Webhook Controller

```typescript
// src/modules/webhooks/controllers/whatsapp-webhook.controller.ts

import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Public } from 'src/common/decorator/public.decorator';
import { IngestionService } from '../../Ingestion/ingestion.service';
import { WhatsAppAdapter } from '../adapters/whatsapp.adapter';
import { WhatsAppWebhookPayload } from '../dto/whatsapp-webhook.dto';
import * as crypto from 'crypto';

/**
 * WhatsApp Cloud API Webhook Controller
 *
 * Handles two endpoints:
 *   GET  /webhook/whatsapp  — Verification challenge (called once during setup)
 *   POST /webhook/whatsapp  — Message delivery (called every time someone messages)
 *
 * SECURITY:
 *   - GET: Verifies using WHATSAPP_VERIFY_TOKEN
 *   - POST: Verifies using HMAC-SHA256 signature (WHATSAPP_APP_SECRET)
 *
 * Both endpoints are @Public() — no JWT auth (webhooks can't send auth headers)
 */
@Controller('webhook/whatsapp')
@Public()
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    private ingestionService: IngestionService,
    private whatsAppAdapter: WhatsAppAdapter,
    private config: ConfigService,
  ) {
    this.verifyToken = this.config.getOrThrow('WHATSAPP_VERIFY_TOKEN');
    this.appSecret = this.config.get('WHATSAPP_APP_SECRET', '');
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /webhook/whatsapp — Verification Challenge
  //
  // Meta calls this ONCE when you set up the webhook URL.
  // It sends a challenge string and expects you to echo it back.
  //
  // Query params: 
  //   hub.mode         = "subscribe"
  //   hub.verify_token = your WHATSAPP_VERIFY_TOKEN
  //   hub.challenge    = random string to echo back
  // ═══════════════════════════════════════════════════════════════════

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    this.logger.log(`🔑 WhatsApp verification request: mode=${mode}`);

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('✅ WhatsApp webhook verified successfully');
      return challenge; // Echo the challenge back — this confirms ownership
    }

    this.logger.warn('❌ WhatsApp verification failed: token mismatch');
    throw new ForbiddenException('Verification failed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /webhook/whatsapp — Receive Messages
  //
  // Meta sends this every time someone messages your WhatsApp number.
  // Also sends delivery status updates (sent, delivered, read).
  //
  // IMPORTANT: Always return 200 quickly. Meta will retry if you don't
  //            respond within 20 seconds (and eventually disable your webhook).
  // ═══════════════════════════════════════════════════════════════════

  @Post()
  @HttpCode(HttpStatus.OK) // Must return 200 — Meta expects it
  async handleMessage(
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // 1. Verify webhook signature (optional but recommended)
    if (this.appSecret) {
      this.verifySignature(req);
    }

    // 2. Parse messages from the payload
    const messages = this.whatsAppAdapter.parseInbound(payload);

    if (messages.length === 0) {
      // This might be a status update (delivered, read) — not a new message
      const statusUpdates = this.whatsAppAdapter.parseStatusUpdates(payload);
      if (statusUpdates.length > 0) {
        this.logger.debug(`📊 Received ${statusUpdates.length} delivery status update(s)`);
        // TODO: Update ConversationMessage.deliveryStatus
      }
      return { status: 'ok', processed: 0 };
    }

    // 3. Ingest each message (usually just 1)
    let processed = 0;
    for (const dto of messages) {
      try {
        await this.ingestionService.ingest(dto);
        processed++;
      } catch (error) {
        // Log but don't fail — we need to return 200 to Meta
        this.logger.error(`Failed to ingest WhatsApp message: ${error.message}`);
      }
    }

    this.logger.log(`📱 Processed ${processed}/${messages.length} WhatsApp message(s)`);
    return { status: 'ok', processed };
  }

  // ═══════════════════════════════════════════════════════════════════
  // SIGNATURE VERIFICATION
  //
  // Meta signs every webhook request with your app secret.
  // Header: X-Hub-Signature-256 = sha256=<hmac_hash>
  //
  // This prevents attackers from faking webhook calls.
  // ═══════════════════════════════════════════════════════════════════

  private verifySignature(req: RawBodyRequest<Request>): void {
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) {
      this.logger.warn('⚠️ No X-Hub-Signature-256 header — skipping verification');
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('⚠️ No raw body available for signature verification');
      return;
    }

    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', this.appSecret)
        .update(rawBody)
        .digest('hex');

    if (signature !== expectedSignature) {
      this.logger.error('❌ WhatsApp webhook signature mismatch!');
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
```

---

## Step 6: Email Webhook (SendGrid Inbound Parse)

### How SendGrid Inbound Parse Works

```
1. You own a domain (e.g., yourcompany.com)
2. Set up an MX record: enquiry.yourcompany.com → mx.sendgrid.net
3. In SendGrid Dashboard → Inbound Parse → Add Host
4. Set URL: https://yourdomain.com/api/v1/webhook/email
5. Any email sent to *@enquiry.yourcompany.com is forwarded to your webhook
```

### What SendGrid Sends

SendGrid forwards emails as **multipart/form-data** POST requests:

```
POST /webhook/email
Content-Type: multipart/form-data

to=sales@enquiry.yourcompany.com
from=buyer@gmail.com
subject=Need pricing for bulk order
text=Hi, I'm interested in ordering 500 units of your premium widget...
html=<html>...same content as HTML...</html>
sender_ip=1.2.3.4
SPF=pass
envelope={"to":["sales@enquiry.yourcompany.com"],"from":"buyer@gmail.com"}
```

---

## Step 7: Email Webhook DTO

```typescript
// src/modules/webhooks/dto/email-webhook.dto.ts

/**
 * SendGrid Inbound Parse webhook payload.
 * Sent as multipart/form-data.
 *
 * Full docs: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
 */
export interface EmailWebhookPayload {
  to: string;            // "sales@enquiry.yourcompany.com"
  from: string;          // "Rahul <buyer@gmail.com>" or just "buyer@gmail.com"
  subject: string;       // Email subject line
  text: string;          // Plain text body
  html?: string;         // HTML body (optional)
  sender_ip?: string;    // Sender's IP address
  SPF?: string;          // SPF verification result
  envelope?: string;     // JSON string: {"to":[...],"from":"..."}
  charsets?: string;     // JSON string of character sets
  attachments?: string;  // Number of attachments (as string)
}
```

---

## Step 8: Email Adapter

```typescript
// src/modules/webhooks/adapters/email.adapter.ts

import { Injectable, Logger } from '@nestjs/common';
import { EmailWebhookPayload } from '../dto/email-webhook.dto';
import { IngestMessageDto } from '../../Ingestion/dto/incoming-message.dto';
import { MessageChannel } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * Parses SendGrid Inbound Parse webhook payloads into IngestMessageDto.
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);

  parseInbound(payload: EmailWebhookPayload): IngestMessageDto | null {
    // Extract clean email address from "Name <email>" format
    const fromEmail = this.extractEmail(payload.from);
    if (!fromEmail) {
      this.logger.warn(`Could not extract email from: ${payload.from}`);
      return null;
    }

    // Prefer plain text body, fall back to stripped HTML
    const body = payload.text || this.stripHtml(payload.html || '') || '';
    if (!body.trim()) {
      this.logger.debug(`Empty email body from ${fromEmail}`);
      return null;
    }

    // Generate a unique message ID from content (emails don't always have Message-ID)
    const externalId = `email-${crypto
      .createHash('sha256')
      .update(`${fromEmail}:${payload.subject}:${payload.text?.substring(0, 200)}:${Date.now()}`)
      .digest('hex')
      .substring(0, 16)}`;

    const dto: IngestMessageDto = {
      channel: MessageChannel.EMAIL,
      externalId,
      from: fromEmail,
      to: this.extractEmail(payload.to) || undefined,
      subject: payload.subject || undefined,
      body: body.substring(0, 10000), // Cap at 10K chars (safety)
      rawPayload: payload as any,
    };

    this.logger.log(
      `📧 Parsed email from ${fromEmail}: "${(payload.subject || 'No Subject').substring(0, 50)}"`,
    );

    return dto;
  }

  /**
   * Extract clean email from formats like:
   *   "Rahul Singh <rahul@gmail.com>" → "rahul@gmail.com"
   *   "rahul@gmail.com"               → "rahul@gmail.com"
   */
  private extractEmail(raw: string): string | null {
    if (!raw) return null;

    // Try to extract from "Name <email>" format
    const match = raw.match(/<([^>]+)>/);
    if (match) return match[1].toLowerCase().trim();

    // Check if it's already a plain email
    if (raw.includes('@')) return raw.toLowerCase().trim();

    return null;
  }

  /**
   * Strip HTML tags to get plain text.
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
```

---

## Step 9: Email Webhook Controller

```typescript
// src/modules/webhooks/controllers/email-webhook.controller.ts

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Public } from 'src/common/decorator/public.decorator';
import { IngestionService } from '../../Ingestion/ingestion.service';
import { EmailAdapter } from '../adapters/email.adapter';
import { EmailWebhookPayload } from '../dto/email-webhook.dto';

/**
 * SendGrid Inbound Parse Webhook Controller
 *
 * Receives forwarded emails from SendGrid and passes them to IngestionService.
 *
 * IMPORTANT: SendGrid sends multipart/form-data, not JSON.
 * NestJS needs multer or body-parser configured to handle this.
 *
 * @Public() — No JWT auth (webhooks can't authenticate)
 */
@Controller('webhook/email')
@Public()
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private ingestionService: IngestionService,
    private emailAdapter: EmailAdapter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK) // SendGrid expects 200
  async handleInboundEmail(@Body() payload: EmailWebhookPayload) {
    this.logger.log(`📧 Received inbound email from: ${payload.from}`);

    // 1. Parse the email payload into our DTO
    const dto = this.emailAdapter.parseInbound(payload);

    if (!dto) {
      this.logger.warn('Could not parse email — skipping');
      return { status: 'skipped' };
    }

    // 2. Send to ingestion pipeline (same as WhatsApp)
    try {
      await this.ingestionService.ingest(dto);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error(`Failed to ingest email: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }
}
```

---

## Step 10: Webhook Module

```typescript
// src/modules/webhooks/webhook.module.ts

import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './controllers/whatsapp-webhook.controller';
import { EmailWebhookController } from './controllers/email-webhook.controller';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { IngestionModule } from '../Ingestion/ingestion.module';

@Module({
  imports: [
    IngestionModule, // For IngestionService
  ],
  controllers: [
    WhatsAppWebhookController,
    EmailWebhookController,
  ],
  providers: [
    WhatsAppAdapter,
    EmailAdapter,
  ],
  exports: [
    WhatsAppAdapter,
    EmailAdapter,
  ],
})
export class WebhookModule {}
```

---

## Step 11: IngestMessageDto Update

Make sure your `IngestMessageDto` matches what the adapters produce:

```typescript
// src/modules/Ingestion/dto/incoming-message.dto.ts

import { IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class IngestMessageDto {
  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsString()
  from: string;          // Phone number (WhatsApp) or email address (Email)

  @IsOptional()
  @IsString()
  to?: string;           // Your receiving number/email

  @IsOptional()
  @IsString()
  subject?: string;      // Email subject (null for WhatsApp)

  @IsString()
  body: string;          // The actual message text

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, any>;
}
```

---

## Step 12: Enable Raw Body (for WhatsApp Signature Verification)

WhatsApp signature verification needs the raw request body. Update `main.ts`:

```typescript
// src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // ← IMPORTANT: Enable raw body for webhook signature verification
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}
bootstrap();
```

---

## Step 13: Local Development with ngrok

WhatsApp and SendGrid need a **public URL** to send webhooks to. During local development, use ngrok:

```bash
# Install ngrok (one-time)
npm install -g ngrok
# OR download from https://ngrok.com

# Start your backend
npm run start:dev

# In another terminal, tunnel port 4000
ngrok http 4000
```

ngrok gives you a URL like `https://a1b2c3d4.ngrok-free.app`. Use this in:

1. **Meta Developer Dashboard** → WhatsApp → Configuration → Callback URL:
   ```
   https://a1b2c3d4.ngrok-free.app/api/v1/webhook/whatsapp
   ```

2. **SendGrid Dashboard** → Inbound Parse → URL:
   ```
   https://a1b2c3d4.ngrok-free.app/api/v1/webhook/email
   ```

> ⚠️ ngrok URL changes every time you restart it (unless you have a paid plan). Update the webhook URL in Meta/SendGrid when it changes.

---

## Step 14: Testing with cURL

### Test WhatsApp Verification (GET)

```bash
curl "http://localhost:4000/api/v1/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=your-custom-verify-token-here&hub.challenge=test123"

# Should return: test123
```

### Test WhatsApp Message (POST)

```bash
curl -X POST http://localhost:4000/api/v1/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "123456789",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "15551234567",
            "phone_number_id": "123456789012345"
          },
          "contacts": [{
            "profile": { "name": "Rahul Singh" },
            "wa_id": "919876543210"
          }],
          "messages": [{
            "from": "919876543210",
            "id": "wamid.test123",
            "timestamp": "1708000000",
            "type": "text",
            "text": { "body": "Hi, I want to buy 500 units of your premium widget. What is the pricing?" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

### Test Email Webhook (POST)

```bash
curl -X POST http://localhost:4000/api/v1/webhook/email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "sales@enquiry.yourcompany.com",
    "from": "Rahul Singh <rahul@techwidgets.com>",
    "subject": "Bulk Order Inquiry - Premium Widgets",
    "text": "Dear Team,\n\nI am Rahul from TechWidgets Ltd. We are interested in purchasing 500 units of your premium widget for our retail chain.\n\nCould you please share:\n1. Pricing for bulk orders\n2. Delivery timeline\n3. Customization options\n\nRegards,\nRahul Singh\nTechWidgets Ltd.",
    "sender_ip": "1.2.3.4",
    "SPF": "pass"
  }'
```

---

## Complete Message Flow (End-to-End)

```
📱 Someone WhatsApps "+91-9876543210" → "I want to buy your widget"

  1. Meta sends POST to /api/v1/webhook/whatsapp
  2. WhatsAppWebhookController receives it
  3. WhatsAppAdapter.parseInbound() → IngestMessageDto
  4. IngestionService.ingest(dto)
     ├── Idempotency check (wamid.test123 already processed?)
     ├── ContactService.resolve(WHATSAPP, "+919876543210")
     │   └── Contact created (or found)
     ├── InboundMessage saved (contactId linked)
     ├── Open enquiry for this contact? NO (first message)
     └── Queue qualification job
  5. BullMQ worker picks up job
  6. QualificationService.qualify()
     └── AIClassifier.classify() → isLead: true, confidence: 92
  7. QualificationResult saved
  8. Event: 'enquiry.qualified' emitted
  9. EnquiryService.handleQualified()
     └── Enquiry #1 created (linked to Contact)
  10. Staff sees new enquiry in inbox! ✅
```

---

## Quick Reference: What Each File Does

| File | Purpose |
|------|---------|
| `whatsapp-webhook.controller.ts` | Receives raw WhatsApp webhooks, handles verification |
| `email-webhook.controller.ts` | Receives raw email webhooks from SendGrid |
| `whatsapp.adapter.ts` | Parses WA payload into IngestMessageDto |
| `email.adapter.ts` | Parses email payload into IngestMessageDto |
| `whatsapp-webhook.dto.ts` | TypeScript types for WhatsApp payload |
| `email-webhook.dto.ts` | TypeScript types for email payload |
| `webhook.module.ts` | Wires everything together |

---

**Continue to [Part 10: Outbound Pipeline →](./PART10_OUTBOUND_PIPELINE.md)**
