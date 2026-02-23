import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { ContactService } from '../contact/contact.service';
import {
  CreateEnquiryDto,
  ChangeStatusDto,
  SendMessageDto,
  AddNoteDto,
} from './dto/create-enquiry.dto';
// import { InboxQueryDto } from './dto/inbox-query.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
// import { canSendMessage, isEnquiryClosed } from './policy/enquiry.policy';
import {
  EnquiryStatus,
  EnquiryType,
  EnquiryIntent,
  Enquiry,
  MessageChannel,
} from '@prisma/client';
import { AppAbility } from '../casl/casl.types';
import { accessibleBy } from '@casl/prisma';
import { create } from 'domain';

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(
    private prisma: PrismaService,
   
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // EVENT LISTENER: Handle qualified inbound message
  //
  // THIS IS THE CORE LOGIC. When a message is qualified as REAL_ENQUIRY,
  // we decide: create a NEW enquiry or APPEND to existing?
  //
  // RULE: If Contact has an open enquiry → APPEND. Otherwise → CREATE.
  // ═══════════════════════════════════════════════════════════════════

  @OnEvent('enquiry.qualified')
async handleQualified(payload: {
  inboundMessageId: string;
  contactId: string;
  intent?: string;
  urgency?: number;
  priority?: number;
  extractedData?: any;
}) {

  const { inboundMessageId, contactId, intent, urgency, priority, extractedData } = payload;
   if (!contactId) {
      this.logger.error(`No contactId for message ${inboundMessageId} — cannot create enquiry`);
      return;
    }


    // Load the inbound message to get the actual content
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });
    console.log("message ",message)

    if (!message) {
      this.logger.error(`InboundMessage ${inboundMessageId} not found`);
      return;
    }

  // Race condition guard: check again in case another message
  // from the same contact already created an enquiry
  const openEnquiry = await this.prisma.enquiry.findFirst({
    where: {
      contactId: payload.contactId,
      status: { notIn: ['CONVERTED', 'CLOSED_LOST'] },
    },
  });
  if (openEnquiry) {
    // Race condition: another message already created the enquiry
    // Just append this message
    await this.prisma.conversationMessage.create({
      data: {
        enquiryId: openEnquiry.id,
        channel: message.channel,
        direction: 'INBOUND',
        from: message.from,
        content: message.body,
      },
    });
    return;
  }
  // Normal case: create new enquiry
  await this.prisma.enquiry.create({
    data: {
      contactId: payload.contactId,
      type: 'REAL',
      status: 'NEW',
      // intent: payload.intent,
      urgency: payload.urgency,
      priority: payload.priority,
      messages: {   // ← relation field name
      create: {
        channel: message.channel,
        direction: 'INBOUND',
        from: message.from,
        content: message.body,
      },
    },
     
    },
  });
}
}