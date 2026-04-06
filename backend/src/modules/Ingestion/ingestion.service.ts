import { Injectable , Logger , ConflictException} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { IngestMessageDto } from './dto/incoming-message.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContactService } from '../contact/contact.service';
import { InboundMessage, QualificationStatus } from '@prisma/client';


@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

    constructor (
        private prisma:PrismaService ,
        @InjectQueue('qualification') private qualificationQueue: Queue,
        private contactService:ContactService,
           private eventEmitter: EventEmitter2,
    ){}
    

    async ingest(dto: IngestMessageDto): Promise<InboundMessage> {
   

    // check for contact existing 
    const {contactId , isNew } = await this.contactService.resolve(dto.channel , dto.from)


   if(!isNew){
    //check if open enquiry exist 
     const openEnquiry = await this.prisma.enquiry.findFirst({
      where: {
        contactId,
        status: {
          notIn: ['CONVERTED', 'CLOSED_LOST'],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (openEnquiry) {
      // ════════════════════════════════════════════════
      // FAST PATH: Known contact with open enquiry
      // Skip qualification entirely — just append
      // ════════════════════════════════════════════════
      console.log("open enquiry found ")
      const inboundMessage = await this.prisma.inboundMessage.create({
        data: {
          channel: dto.channel,
          externalId: dto.externalId,
          from: dto.from,
          to: dto.to,
          subject: dto.subject,
          body: dto.body,
          rawPayload: dto.rawPayload ?? undefined,
          status: 'REAL_ENQUIRY',  // ← Already qualified!
          contactId,
        },
      });
      // Append as ConversationMessage to the open enquiry
      console.log("Message appended in conversation of the enquiry ")
      await this.prisma.conversationMessage.create({
        data: {
          enquiryId: openEnquiry.id,
          channel: dto.channel,
          direction: 'INBOUND',
          from: dto.from,
          to: dto.to,
          subject: dto.subject,
          content: dto.body,
        },
      });
      // Update enquiry tracking
      await this.prisma.enquiry.update({
        where: { id: openEnquiry.id },
        data: {
          lastCustomerReplyAt: new Date(),
          lastActivityAt: new Date(),
        },
      });

      this.eventEmitter.emit('message.inbound.appended', {
        contactId,
        enquiryId: openEnquiry.id,
        message: {
          id: inboundMessage.id,  // will be replaced with ConversationMessage id
          enquiryId: openEnquiry.id,
          channel: dto.channel,
          direction: 'INBOUND',
          from: dto.from,
          to: dto.to,
          content: dto.body,
          createdAt: new Date(),
        },
      });
      this.logger.log(
        `📨 Appended message to existing Enquiry ${openEnquiry.id} (contact: ${contactId})`,
      );
      return inboundMessage;
    }
  }
    // ════════════════════════════════════════════════
    // SLOW PATH: New contact or all enquiries closed
    // Must qualify to determine if real or spam
    // ════════════════════════════════════════════════

    console.log("the qualification round is created")
    const inboundMessage = await this.prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        from: dto.from,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        rawPayload: dto.rawPayload ?? undefined,
        status: 'PENDING',  // ← Needs qualification
        contactId,
      },
    });
    // Queue qualification job
    await this.qualificationQueue.add(
      'qualify',
      { inboundMessageId: inboundMessage.id },
      {
        jobId: `qualify-${inboundMessage.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
    this.logger.log(
      `📨 Ingested message ${inboundMessage.id} → queued for qualification`,
    );
    return inboundMessage;
  }
}