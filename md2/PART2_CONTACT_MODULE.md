# 👤 Part 2: Contact Module — Unified Identity Layer

> **The most important new module.** Every person who contacts you gets a Contact record. This is how the system knows that "+91-9876543210" on WhatsApp and "rahul@gmail.com" on Email are the SAME person.

---

## Why This Module Exists

**Before (v1):** Phone and email were stored directly on the Enquiry. Every new message = new Enquiry. No concept of "this is the same person."

**After (v2):** A Contact is a person. They can have multiple channels (phone, email). All their Enquiries are linked to their Contact. When they message again, the system finds their Contact and appends to their existing conversation.

---

## File Structure

```
src/modules/contact/
├── contact.module.ts
├── contact.service.ts
├── contact.controller.ts
└── dto/
    ├── merge-contacts.dto.ts
    └── update-contact.dto.ts
```

---

## DTOs

### `src/modules/contact/dto/update-contact.dto.ts`

```typescript
import { IsOptional, IsString } from 'class-validator';

/**
 * Used by staff to update a Contact's profile.
 * Name, organization, and notes can be edited.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  organization?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

### `src/modules/contact/dto/merge-contacts.dto.ts`

```typescript
import { IsUUID } from 'class-validator';

/**
 * Admin merges two contacts into one.
 *
 * HOW IT WORKS:
 *   - sourceContactId: the "duplicate" contact that will be DELETED
 *   - targetContactId: the "primary" contact that KEEPS everything
 *
 * WHAT HAPPENS:
 *   1. All ContactChannels from source → moved to target
 *   2. All InboundMessages from source → re-linked to target
 *   3. All Enquiries from source → re-linked to target
 *      (if both have open enquiries, source's messages merge into target's)
 *   4. Source Contact is deleted
 *
 * THIS IS COMPLETELY MANUAL. No automatic merging.
 * Only admin/manager can do this.
 */
export class MergeContactsDto {
  @IsUUID()
  sourceContactId: string; // The duplicate — will be DELETED

  @IsUUID()
  targetContactId: string; // The primary — keeps everything
}
```

---

## `src/modules/contact/contact.service.ts`

```typescript
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { MessageChannel, EnquiryStatus } from '@prisma/client';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════
  // CONTACT RESOLUTION — The core method called by Ingestion
  //
  // This is the HEART of the Contact system. When a new message arrives,
  // we need to figure out: "Do we already know this person?"
  //
  // Logic:
  //   1. Look up ContactChannel by (channel, identifier)
  //      e.g., (WHATSAPP, +91-9876543210)
  //   2. If found → return the existing Contact (we know this person!)
  //   3. If NOT found → create a new Contact + link this channel to them
  //   4. Update lastSeenAt on the Contact
  // ═══════════════════════════════════════════════════════════════════

  async resolve(
    channel: MessageChannel,
    identifier: string,
  ): Promise<{ contactId: string; isNew: boolean }> {
    // Step 1: Do we already have this channel+identifier registered?
    const existing = await this.prisma.contactChannel.findUnique({
      where: {
        channel_identifier: { channel, identifier },
      },
      include: { contact: true },
    });

    if (existing) {
      // We know this person! Update their lastSeenAt.
      await this.prisma.contact.update({
        where: { id: existing.contactId },
        data: { lastSeenAt: new Date() },
      });

      this.logger.debug(
        `👤 Resolved existing contact: ${existing.contact.displayName} (${existing.contactId})`,
      );

      return { contactId: existing.contactId, isNew: false };
    }

    // Step 2: New person — create Contact + link this channel
    const contact = await this.prisma.contact.create({
      data: {
        displayName: 'Unknown', // Will be updated when AI extracts name or staff edits
        channels: {
          create: {
            channel,
            identifier,
            isPrimary: true, // First channel is primary by default
          },
        },
      },
    });

    this.logger.log(
      `🆕 New contact created: ${contact.id} via ${channel}:${identifier}`,
    );

    return { contactId: contact.id, isNew: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FIND OPEN ENQUIRY — Check if this Contact has an ongoing conversation
  //
  // Called AFTER qualification, when we need to decide:
  //   "Create new enquiry?" or "Append to existing?"
  //
  // Rules:
  //   - If any Enquiry for this Contact has a status that is NOT
  //     CONVERTED or CLOSED_LOST → it's "open", append to it
  //   - If ALL Enquiries are CONVERTED/CLOSED_LOST → create new
  //   - If no Enquiries exist → create new
  // ═══════════════════════════════════════════════════════════════════

  async findOpenEnquiry(contactId: string): Promise<string | null> {
    // These statuses mean the enquiry is "done" — a new message
    // should create a NEW enquiry, not append to a closed one.
    const closedStatuses: EnquiryStatus[] = [
      EnquiryStatus.CONVERTED,
      EnquiryStatus.CLOSED_LOST,
    ];

    const openEnquiry = await this.prisma.enquiry.findFirst({
      where: {
        contactId,
        status: { notIn: closedStatuses },
      },
      orderBy: { lastActivityAt: 'desc' }, // Most recently active first
      select: { id: true },
    });

    if (openEnquiry) {
      this.logger.debug(
        `📎 Found open enquiry ${openEnquiry.id} for contact ${contactId}`,
      );
    }

    return openEnquiry?.id ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // UPDATE CONTACT NAME — Called when AI extracts a name from message
  //
  // Only updates if current name is "Unknown" (don't overwrite
  // staff-edited names with AI guesses)
  // ═══════════════════════════════════════════════════════════════════

  async updateNameIfUnknown(contactId: string, name: string): Promise<void> {
    if (!name || name.trim().length === 0) return;

    await this.prisma.contact.updateMany({
      where: {
        id: contactId,
        displayName: 'Unknown',
      },
      data: { displayName: name.trim() },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANUAL UPDATE — Staff edits contact profile
  // ═══════════════════════════════════════════════════════════════════

  async update(contactId: string, dto: UpdateContactDto) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        displayName: dto.displayName ?? contact.displayName,
        organization: dto.organization,
        notes: dto.notes,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTACT PROFILE — Get full details of a contact
  //
  // Shows ALL channels, ALL enquiries, and enquiry counts.
  // This is the "sidebar" view when staff opens an enquiry.
  // ═══════════════════════════════════════════════════════════════════

  async findOne(contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        channels: {
          orderBy: { createdAt: 'asc' },
        },
        enquiries: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            intent: true,
            type: true,
            createdAt: true,
            lastActivityAt: true,
            assignedTo: {
              select: { id: true, displayName: true },
            },
            _count: { select: { messages: true } },
          },
        },
        _count: {
          select: {
            enquiries: true,
            inboundMessages: true,
          },
        },
      },
    });

    if (!contact) throw new NotFoundException('Contact not found');

    return contact;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST CONTACTS — Paginated list with search
  // ═══════════════════════════════════════════════════════════════════

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { page = 1, limit = 20, search } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { organization: { contains: search, mode: 'insensitive' } },
        {
          channels: {
            some: { identifier: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: {
          channels: true,
          _count: { select: { enquiries: true } },
        },
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      items: data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANUAL MERGE — Admin manually merges two contacts into one
  //
  // This is the ONLY way contacts get merged. No automatic merging.
  //
  // The "source" contact is the DUPLICATE (gets deleted).
  // The "target" contact is the PRIMARY (keeps everything).
  //
  // What happens in a single transaction:
  //   1. Move all ContactChannels from source → target
  //   2. Move all InboundMessages from source → target
  //   3. Handle enquiry merging:
  //      - If target has an OPEN enquiry and source has an OPEN enquiry:
  //        → Move all ConversationMessages from source's enquiry → target's enquiry
  //        → Move all Timeline entries
  //        → Delete source's enquiry
  //      - If source has CLOSED enquiries, just re-link them to target
  //   4. Delete source Contact
  //   5. Record merge in timeline
  // ═══════════════════════════════════════════════════════════════════

  async mergeContacts(
    sourceContactId: string,
    targetContactId: string,
    userId: string,
  ) {
    if (sourceContactId === targetContactId) {
      throw new BadRequestException('Cannot merge a contact with itself');
    }

    const [source, target] = await Promise.all([
      this.prisma.contact.findUnique({
        where: { id: sourceContactId },
        include: {
          channels: true,
          enquiries: {
            include: {
              messages: true,
              timeline: true,
              notes: true,
            },
          },
        },
      }),
      this.prisma.contact.findUnique({
        where: { id: targetContactId },
        include: {
          enquiries: {
            where: {
              status: {
                notIn: [EnquiryStatus.CONVERTED, EnquiryStatus.CLOSED_LOST],
              },
            },
          },
        },
      }),
    ]);

    if (!source) throw new NotFoundException('Source contact not found');
    if (!target) throw new NotFoundException('Target contact not found');

    await this.prisma.$transaction(async (tx) => {
      // ── Step 1: Move all channels from source → target ──
      for (const channel of source.channels) {
        // Check if target already has this channel+identifier
        const existingChannel = await tx.contactChannel.findUnique({
          where: {
            channel_identifier: {
              channel: channel.channel,
              identifier: channel.identifier,
            },
          },
        });

        if (existingChannel && existingChannel.contactId === targetContactId) {
          // Target already has this channel — delete duplicate from source
          await tx.contactChannel.delete({ where: { id: channel.id } });
        } else if (existingChannel) {
          // Another contact has it (shouldn't happen, but defensive)
          await tx.contactChannel.delete({ where: { id: channel.id } });
        } else {
          // Move channel to target
          await tx.contactChannel.update({
            where: { id: channel.id },
            data: { contactId: targetContactId },
          });
        }
      }

      // ── Step 2: Move all InboundMessages from source → target ──
      await tx.inboundMessage.updateMany({
        where: { contactId: sourceContactId },
        data: { contactId: targetContactId },
      });

      // ── Step 3: Handle enquiry merging ──
      const targetOpenEnquiry = target.enquiries[0]; // Target's open enquiry (if any)

      for (const sourceEnquiry of source.enquiries) {
        const isSourceOpen = ![
          EnquiryStatus.CONVERTED,
          EnquiryStatus.CLOSED_LOST,
        ].includes(sourceEnquiry.status);

        if (isSourceOpen && targetOpenEnquiry) {
          // BOTH have open enquiries → merge messages into target's enquiry

          // Move all conversation messages
          await tx.conversationMessage.updateMany({
            where: { enquiryId: sourceEnquiry.id },
            data: { enquiryId: targetOpenEnquiry.id },
          });

          // Move all timeline entries
          await tx.enquiryTimeline.updateMany({
            where: { enquiryId: sourceEnquiry.id },
            data: { enquiryId: targetOpenEnquiry.id },
          });

          // Move all internal notes
          await tx.internalNote.updateMany({
            where: { enquiryId: sourceEnquiry.id },
            data: { enquiryId: targetOpenEnquiry.id },
          });

          // Add merge event to timeline
          await tx.enquiryTimeline.create({
            data: {
              enquiryId: targetOpenEnquiry.id,
              type: 'CONTACT_MERGED',
              createdBy: userId,
              metadata: {
                mergedFromContactId: sourceContactId,
                mergedFromContactName: source.displayName,
                mergedFromEnquiryId: sourceEnquiry.id,
                messagesMovedCount: sourceEnquiry.messages.length,
              },
            },
          });

          // Delete the source enquiry (messages already moved)
          await tx.enquiry.delete({ where: { id: sourceEnquiry.id } });

          // Update lastActivityAt on target enquiry
          await tx.enquiry.update({
            where: { id: targetOpenEnquiry.id },
            data: { lastActivityAt: new Date() },
          });
        } else {
          // Source enquiry is closed OR target has no open enquiry
          // Just re-link the enquiry to the target contact
          await tx.enquiry.update({
            where: { id: sourceEnquiry.id },
            data: { contactId: targetContactId },
          });
        }
      }

      // ── Step 4: Delete source contact ──
      await tx.contact.delete({ where: { id: sourceContactId } });
    });

    this.logger.log(
      `🔗 Contacts merged: ${sourceContactId} (${source.displayName}) → ${targetContactId} (${target.displayName}) by ${userId}`,
    );

    // Return the merged contact profile
    return this.findOne(targetContactId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADD CHANNEL — Manually add a new channel to an existing contact
  //
  // Used by staff: "I know this WhatsApp contact also uses this email"
  // ═══════════════════════════════════════════════════════════════════

  async addChannel(
    contactId: string,
    channel: MessageChannel,
    identifier: string,
  ) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    // Check if this channel+identifier is already taken
    const existing = await this.prisma.contactChannel.findUnique({
      where: { channel_identifier: { channel, identifier } },
    });

    if (existing) {
      if (existing.contactId === contactId) {
        // Already linked to this contact — no-op
        return this.findOne(contactId);
      }
      throw new BadRequestException(
        `This ${channel} identifier is already linked to another contact. Merge the contacts instead.`,
      );
    }

    await this.prisma.contactChannel.create({
      data: { contactId, channel, identifier },
    });

    return this.findOne(contactId);
  }
}
```

---

## `src/modules/contact/contact.controller.ts`

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContactService } from './contact.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import type { Request } from 'express';

@Controller('contacts')
@UseGuards(CaslGuard)
export class ContactController {
  constructor(private contactService: ContactService) {}

  // ── List contacts (paginated + search) ──
  @Get()
  @CheckAbility({ action: 'read', subject: 'Contact' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.contactService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
    });
  }

  // ── Get single contact profile ──
  @Get(':id')
  @CheckAbility({ action: 'read', subject: 'Contact' })
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id);
  }

  // ── Update contact profile ──
  @Patch(':id')
  @CheckAbility({ action: 'update', subject: 'Contact' })
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactService.update(id, dto);
  }

  // ── Add channel to contact ──
  @Post(':id/channels')
  @CheckAbility({ action: 'update', subject: 'Contact' })
  addChannel(
    @Param('id') id: string,
    @Body() body: { channel: string; identifier: string },
  ) {
    return this.contactService.addChannel(
      id,
      body.channel as any,
      body.identifier,
    );
  }

  // ── Merge two contacts (ADMIN ONLY) ──
  @Post('merge')
  @CheckAbility({ action: 'merge', subject: 'Contact' })
  @HttpCode(HttpStatus.OK)
  merge(@Body() dto: MergeContactsDto, @Req() req: Request) {
    return this.contactService.mergeContacts(
      dto.sourceContactId,
      dto.targetContactId,
      req.user!.userId,
    );
  }
}
```

---

## `src/modules/contact/contact.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';

@Module({
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService], // Exported so Ingestion + Enquiry modules can use it
})
export class ContactModule {}
```

---

## How Contact Resolution Fits Into the Pipeline

```
Webhook delivers a message from +91-9876543210
        ↓
IngestionService.ingest()
        ↓
  ┌── ContactService.resolve(WHATSAPP, "+91-9876543210") ──┐
  │                                                         │
  │  DB lookup: ContactChannel(WHATSAPP, +91-9876543210)?  │
  │                                                         │
  │  ┌─ FOUND ──────────────────┐   ┌─ NOT FOUND ────────┐│
  │  │ Return existing Contact  │   │ Create new Contact  ││
  │  │ contactId: "abc-123"     │   │ contactId: "xyz-789"││
  │  │ isNew: false             │   │ isNew: true         ││
  │  └──────────────────────────┘   └─────────────────────┘│
  └─────────────────────────────────────────────────────────┘
        ↓
  InboundMessage.create({ contactId: "abc-123", ... })
        ↓
  Queue qualification job
```

---

## How Manual Merge Works (Visual)

```
BEFORE MERGE:
────────────
Contact A (Target — keeps everything):         Contact B (Source — will be deleted):
  WhatsApp: +91-9876543210                       Email: rahul@gmail.com
  Enquiry #1 (OPEN, 3 messages)                  Enquiry #2 (OPEN, 2 messages)

Admin clicks: "Merge B into A"

DURING MERGE (single transaction):
───────────
  1. Email channel → moved to Contact A
  2. Enquiry #2's messages → moved to Enquiry #1
  3. Enquiry #2's timeline → moved to Enquiry #1
  4. Enquiry #2 → deleted
  5. Contact B → deleted
  6. Timeline entry added: "Contact merged by Admin"

AFTER MERGE:
────────────
Contact A (merged):
  WhatsApp: +91-9876543210
  Email: rahul@gmail.com          ← moved from Contact B
  Enquiry #1 (OPEN, 5 messages)   ← 3 original + 2 from Enquiry #2
```

---

**Continue to [Part 3: Ingestion Module →](./PART3_INGESTION_MODULE.md)**
