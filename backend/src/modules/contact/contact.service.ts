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

async resolve(channel:MessageChannel,identifier:string):Promise<{contactId:string,isNew:boolean}>{
  
    console.log("checking for contact")
    const existing = await this.prisma.contactChannel.findUnique({
        where:{
            channel_identifier:{
                channel,
                identifier,
            }
        },
        include:{
            contact:true
        }
    })

        if (existing) {
      // We know this person! Update their lastSeenAt.
      console.log("contact found")
      await this.prisma.contact.update({
        where: { id: existing.contactId },
        data: { lastSeenAt: new Date() },
      });

      this.logger.debug(
        `👤 Resolved existing contact: ${existing.contact.displayName} (${existing.contactId})`,
      );

      return { contactId: existing.contactId, isNew: false };
    }


    console.log("contact created ")
    const contact = await this.prisma.contact.create({
        data:{
            displayName:"Unknown",
            channels:{
                create:{
                    channel,
                    identifier,
                   
                }
            }
        }
    })

    this.logger.debug(
      `🆕 Created new contact: ${contact.displayName} (${contact.id})`,
    );

    return { contactId: contact.id, isNew: true };
}


}