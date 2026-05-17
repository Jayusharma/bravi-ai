# Million Dollar Outbound

## Scope For This Phase

This file is only for the first outbound module.

Outbound means one thing here:

- user writes a reply
- system saves draft
- system sends the message
- system tracks sent/failed/delivered state

This phase includes only:

- outbound reply sending for WhatsApp
- outbound reply sending for email
- frontend compose behavior by channel
- draft autosave and auto-clear
- attachment entry point with `+` icon

This phase does not include:

- WhatsApp 24-hour enforcement
- templates
- policy engine
- AI automation
- AI review
- message context generation
- campaign sending
- advanced fallback rulesan

Those come later.

## Product Definition

### WhatsApp outbound

- compose box has body only
- no subject field
- can attach image, video, document
- send creates outbound message and sends through WhatsApp adapter

### Email outbound

- compose box has subject and body
- can attach files
- send creates outbound message and sends through email adapter

### Draft behavior

- while user types, draft is autosaved
- draft belongs to one enquiry and one channel
- if user stops and comes back soon, draft should still be there
- if draft becomes stale, it clears automatically
- if message is successfully sent, draft clears immediately

## Exact UX To Build

### Compose panel

- channel switch: `WHATSAPP` or `EMAIL`
- for WhatsApp:
  - show `body`
  - hide `subject`
- for Email:
  - show `subject`
  - show `body`

### Attachment UX

- show `+` icon near input like WhatsApp
- clicking `+` opens attachment menu
- supported first version:
  - image
  - video
  - document/pdf
- attachments are optional
- first version can support upload + send metadata even if rich preview is basic

### Draft UX

- save draft after short debounce while typing
- restore draft when enquiry chat opens again
- show subtle `Draft saved` state
- clear draft when:
  - message is sent
  - draft expires
  - user switches enquiry and old draft is stale

## Draft Expiry Recommendation

For this phase:

- autosave debounce: `800ms`
- draft expiry: `24 hours`

Why:

- short enough to feel instant
- long enough for unfinished replies during the day
- simple and predictable

## Backend Shape For This Phase

Keep this small. We do not need the full future outbound engine yet.

Use:

- `ConversationMessage` for actual sent messages in timeline
- new `OutboundDraft` table for temporary composer state
- current outbound module for send execution, but clean it up

## Prisma Additions

```prisma
enum DraftStatus {
  ACTIVE
  EXPIRED
  CLEARED
}

enum AttachmentKind {
  IMAGE
  VIDEO
  DOCUMENT
}

model OutboundDraft {
  id         String         @id @default(uuid())
  enquiryId  String
  channel    MessageChannel
  subject    String?
  body       String?
  status     DraftStatus    @default(ACTIVE)
  expiresAt  DateTime
  createdBy  String
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  enquiry Enquiry @relation(fields: [enquiryId], references: [id], onDelete: Cascade)

  attachments DraftAttachment[]

  @@unique([enquiryId, channel, createdBy, status])
  @@index([enquiryId, channel])
  @@index([expiresAt, status])
}

model DraftAttachment {
  id          String         @id @default(uuid())
  draftId      String
  kind        AttachmentKind
  fileName    String
  mimeType    String
  fileSize    Int
  storageKey  String
  createdAt   DateTime       @default(now())

  draft OutboundDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)

  @@index([draftId])
}

model MessageAttachment {
  id             String           @id @default(uuid())
  conversationMessageId String
  kind           AttachmentKind
  fileName       String
  mimeType       String
  fileSize       Int
  storageKey     String
  createdAt      DateTime         @default(now())

  message ConversationMessage @relation(fields: [conversationMessageId], references: [id], onDelete: Cascade)

  @@index([conversationMessageId])
}
```

## Important Schema Note

Current `ConversationMessage` is enough for sent outbound messages if we add attachment relation support.  
We do not need a separate full `OutboundMessage` table in this phase.

That keeps Phase 1 simple.

## Backend Modules To Build

```text
src/modules/outbound/
  outbound.module.ts
  outbound.controller.ts
  outbound.service.ts
  channel-router.service.ts
  dto/
    send-outbound.dto.ts
    save-draft.dto.ts
  adapters/
    channel-adapter.interface.ts
    whatsapp.adapter.ts
    email.adapter.ts
  draft/
    outbound-draft.service.ts
    draft-cleanup.service.ts
```

## Core Flows

### 1. Save draft

```text
user types in compose input
  ->
frontend debounce
  ->
POST /outbound/drafts
  ->
upsert draft by enquiryId + channel + createdBy
  ->
set expiresAt = now + 24h
```

### 2. Load draft

```text
user opens enquiry
  ->
GET /outbound/drafts/:enquiryId?channel=WHATSAPP
  ->
return active non-expired draft
```

### 3. Send outbound reply

```text
user clicks send
  ->
validate channel fields
  ->
create ConversationMessage with direction=OUTBOUND and deliveryStatus=PENDING
  ->
send via correct adapter
  ->
update ConversationMessage to SENT or FAILED
  ->
clear matching draft
```

### 4. Expire old draft

```text
cron job runs every 10 minutes
  ->
find ACTIVE drafts where expiresAt < now
  ->
mark EXPIRED
```

## Validation Rules

### WhatsApp send validation

- `body` required
- `subject` must be empty or ignored
- must have a WhatsApp contact channel for recipient

### Email send validation

- `subject` required
- `body` required
- must have an email contact channel for recipient

### Attachment validation

- reject unsupported types
- reject oversized files
- allow file metadata only after upload succeeds

## API Design

### Send reply

```ts
// POST /outbound/send
export class SendOutboundDto {
  enquiryId: string;
  channel: MessageChannel;
  body: string;
  subject?: string;
  attachmentIds?: string[];
}
```

### Save draft

```ts
// POST /outbound/drafts
export class SaveDraftDto {
  enquiryId: string;
  channel: MessageChannel;
  body?: string;
  subject?: string;
  attachmentIds?: string[];
}
```

## Production-Ready Backend Code

### DTO

```ts
// src/modules/outbound/dto/send-outbound.dto.ts
import { MessageChannel } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class SendOutboundDto {
  @IsUUID()
  enquiryId: string;

  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @ValidateIf((o) => o.channel === MessageChannel.EMAIL)
  @IsString()
  subject?: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
```

### Draft service

```ts
// src/modules/outbound/draft/outbound-draft.service.ts
import { Injectable } from '@nestjs/common';
import { DraftStatus, MessageChannel } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class OutboundDraftService {
  private static readonly DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async save(input: {
    enquiryId: string;
    channel: MessageChannel;
    subject?: string;
    body?: string;
    createdBy: string;
  }) {
    await this.prisma.outboundDraft.updateMany({
      where: {
        enquiryId: input.enquiryId,
        channel: input.channel,
        createdBy: input.createdBy,
        status: DraftStatus.ACTIVE,
        expiresAt: { lt: new Date() },
      },
      data: { status: DraftStatus.EXPIRED },
    });

    const existing = await this.prisma.outboundDraft.findFirst({
      where: {
        enquiryId: input.enquiryId,
        channel: input.channel,
        createdBy: input.createdBy,
        status: DraftStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });

    const expiresAt = new Date(Date.now() + OutboundDraftService.DRAFT_TTL_MS);

    if (existing) {
      return this.prisma.outboundDraft.update({
        where: { id: existing.id },
        data: {
          subject: input.channel === MessageChannel.EMAIL ? input.subject : null,
          body: input.body,
          expiresAt,
        },
      });
    }

    return this.prisma.outboundDraft.create({
      data: {
        enquiryId: input.enquiryId,
        channel: input.channel,
        subject: input.channel === MessageChannel.EMAIL ? input.subject : null,
        body: input.body,
        createdBy: input.createdBy,
        expiresAt,
      },
    });
  }

  async getActive(enquiryId: string, channel: MessageChannel, createdBy: string) {
    return this.prisma.outboundDraft.findFirst({
      where: {
        enquiryId,
        channel,
        createdBy,
        status: DraftStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: { attachments: true },
    });
  }

  async clear(enquiryId: string, channel: MessageChannel, createdBy: string) {
    await this.prisma.outboundDraft.updateMany({
      where: {
        enquiryId,
        channel,
        createdBy,
        status: DraftStatus.ACTIVE,
      },
      data: {
        status: DraftStatus.CLEARED,
      },
    });
  }
}
```

### Draft cleanup job

```ts
// src/modules/outbound/draft/draft-cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DraftStatus } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class DraftCleanupService {
  private readonly logger = new Logger(DraftCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/10 * * * *')
  async expireDrafts() {
    const result = await this.prisma.outboundDraft.updateMany({
      where: {
        status: DraftStatus.ACTIVE,
        expiresAt: { lt: new Date() },
      },
      data: {
        status: DraftStatus.EXPIRED,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} outbound drafts`);
    }
  }
}
```

### Channel adapter contract

```ts
// src/modules/outbound/adapters/channel-adapter.interface.ts
import { MessageChannel } from '@prisma/client';

export interface SendParams {
  to: string;
  body: string;
  subject?: string;
  attachments?: {
    fileName: string;
    mimeType: string;
    storageKey: string;
  }[];
}

export interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export interface ChannelAdapter {
  readonly channel: MessageChannel;
  isConfigured(): boolean;
  send(params: SendParams): Promise<SendResult>;
}
```

### Channel router

```ts
// src/modules/outbound/channel-router.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, SendParams, SendResult } from './adapters/channel-adapter.interface';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { EmailAdapter } from './adapters/email.adapter';

@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly adapters: Map<MessageChannel, ChannelAdapter>;

  constructor(
    private readonly whatsappAdapter: WhatsAppAdapter,
    private readonly emailAdapter: EmailAdapter,
  ) {
    this.adapters = new Map([
      [MessageChannel.WHATSAPP, this.whatsappAdapter],
      [MessageChannel.EMAIL, this.emailAdapter],
    ]);
  }

  async send(channel: MessageChannel, params: SendParams): Promise<SendResult> {
    const adapter = this.adapters.get(channel);

    if (!adapter) {
      return { success: false, error: `No adapter for ${channel}` };
    }

    if (!adapter.isConfigured()) {
      this.logger.warn(`${channel} adapter not configured`);
      return { success: false, error: `${channel} adapter not configured` };
    }

    return adapter.send(params);
  }
}
```

### Outbound service

```ts
// src/modules/outbound/outbound.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  MessageChannel,
  MessageDirection,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { ChannelRouterService } from './channel-router.service';
import { OutboundDraftService } from './draft/outbound-draft.service';
import { SendOutboundDto } from './dto/send-outbound.dto';

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ChannelRouterService,
    private readonly draftService: OutboundDraftService,
  ) {}

  async sendReply(dto: SendOutboundDto, userId: string) {
    if (dto.channel === MessageChannel.WHATSAPP && dto.subject) {
      throw new BadRequestException('WhatsApp replies do not support subject');
    }

    if (dto.channel === MessageChannel.EMAIL && !dto.subject?.trim()) {
      throw new BadRequestException('Email replies require subject');
    }

    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id: dto.enquiryId },
      include: {
        contact: {
          include: {
            channels: true,
          },
        },
      },
    });

    if (!enquiry) {
      throw new BadRequestException('Enquiry not found');
    }

    const recipient = enquiry.contact.channels.find((item) => item.channel === dto.channel);
    if (!recipient) {
      throw new BadRequestException(`No ${dto.channel} recipient found for contact`);
    }

    const message = await this.prisma.conversationMessage.create({
      data: {
        enquiryId: dto.enquiryId,
        channel: dto.channel,
        direction: MessageDirection.OUTBOUND,
        from: userId,
        to: recipient.identifier,
        subject: dto.channel === MessageChannel.EMAIL ? dto.subject : null,
        content: dto.body,
        deliveryStatus: DeliveryStatus.PENDING,
        sentByUserId: userId,
      },
    });

    const attachments = dto.attachmentIds?.length
      ? await this.prisma.draftAttachment.findMany({
          where: {
            id: { in: dto.attachmentIds },
          },
        })
      : [];

    const result = await this.router.send(dto.channel, {
      to: recipient.identifier,
      subject: dto.channel === MessageChannel.EMAIL ? dto.subject : undefined,
      body: dto.body,
      attachments: attachments.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        storageKey: file.storageKey,
      })),
    });

    if (result.success) {
      await this.prisma.conversationMessage.update({
        where: { id: message.id },
        data: {
          deliveryStatus: DeliveryStatus.SENT,
          externalId: result.externalId,
        },
      });
    } else {
      await this.prisma.conversationMessage.update({
        where: { id: message.id },
        data: {
          deliveryStatus: DeliveryStatus.FAILED,
        },
      });
    }

    if (attachments.length > 0) {
      await this.prisma.messageAttachment.createMany({
        data: attachments.map((file) => ({
          conversationMessageId: message.id,
          kind: file.kind,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          storageKey: file.storageKey,
        })),
      });
    }

    await this.draftService.clear(dto.enquiryId, dto.channel, userId);

    return {
      messageId: message.id,
      success: result.success,
      deliveryStatus: result.success ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
      error: result.error,
    };
  }
}
```

### Controller

```ts
// src/modules/outbound/outbound.controller.ts
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { OutboundService } from './outbound.service';
import { OutboundDraftService } from './draft/outbound-draft.service';
import { SendOutboundDto } from './dto/send-outbound.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

@Controller('outbound')
export class OutboundController {
  constructor(
    private readonly outboundService: OutboundService,
    private readonly draftService: OutboundDraftService,
  ) {}

  @Post('send')
  async send(@Body() dto: SendOutboundDto, @Req() req: any) {
    return this.outboundService.sendReply(dto, req.user.id);
  }

  @Post('drafts')
  async saveDraft(@Body() dto: SaveDraftDto, @Req() req: any) {
    return this.draftService.save({
      enquiryId: dto.enquiryId,
      channel: dto.channel,
      subject: dto.subject,
      body: dto.body,
      createdBy: req.user.id,
    });
  }

  @Get('drafts/:enquiryId')
  async getDraft(
    @Param('enquiryId') enquiryId: string,
    @Query('channel') channel: MessageChannel,
    @Req() req: any,
  ) {
    return this.draftService.getActive(enquiryId, channel, req.user.id);
  }
}
```

## Frontend Requirements

### Compose component behavior

- if selected channel is `WHATSAPP`
  - render textarea only
  - hide subject input
- if selected channel is `EMAIL`
  - render subject input
  - render body textarea

### Draft behavior

- on body/subject change, debounce `800ms`
- save draft with channel-specific payload
- fetch draft on enquiry open
- if returned draft is expired or missing, start empty
- on successful send, clear local compose state immediately

### Attachment behavior

- render `+` icon button
- open file picker or action sheet
- upload file first
- keep uploaded attachment IDs in compose state
- show simple chip/list of selected attachments

## Suggested Frontend State Shape

```ts
type ComposeState = {
  enquiryId: string;
  channel: 'WHATSAPP' | 'EMAIL';
  subject: string;
  body: string;
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
  }[];
  isSavingDraft: boolean;
  lastSavedAt?: string;
};
```

## Implementation Order

### Step 1

- add Prisma tables for drafts and attachments

### Step 2

- implement `OutboundDraftService`
- implement cleanup cron

### Step 3

- clean current `OutboundService`
- add email adapter
- keep WhatsApp adapter
- support simple send reply for both channels

### Step 4

- add frontend compose rules by channel
- add autosave draft
- add restore draft
- add `+` attachment entry point

## Non-Negotiable Tests

- WhatsApp send requires body and ignores subject
- Email send requires subject and body
- send creates outbound `ConversationMessage`
- successful send updates message to `SENT`
- failed send updates message to `FAILED`
- saving draft updates same active draft row
- sent message clears matching draft
- expired draft is not returned as active

## Final Recommendation

For now, keep outbound narrow:

- compose
- save draft
- send reply
- attach files
- update delivery state

Do not mix in future automation rules yet.  
Build this as the clean first outbound layer, then extend it later.
