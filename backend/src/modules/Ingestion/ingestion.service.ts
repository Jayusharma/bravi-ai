import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { EnquiryService } from '../enquiry/enquiry.service';
import { EnquirySource } from '@prisma/client';

@Injectable()
export class IngestionService {
    constructor (
        private prisma:PrismaService ,
        private enquiryService:EnquiryService 
    ){}
    

    async ingest(dto:IncomingMessageDto ){
   

         return this.prisma.$transaction(async (tx) =>{

        
        //find the enquiry if exist 
        let enquiry  = await tx.enquiry.findFirst({
            where:{
                OR:[
                    {email:dto.from},
                    {phone:dto.from}
                ]
            }
        });

        //create enquiry if not exist 
        if (!enquiry) {
            enquiry = await this.enquiryService.createFromMessage({
              source: dto.channel as unknown as EnquirySource,
              from: dto.from,
            });
          }

           // 3) store message (facts)
    await tx.message.create({
        data: {
          enquiryId: enquiry.id,
          channel: dto.channel,
          direction: 'INBOUND',
          externalId: dto.externalMessageId,
          from: dto.from,
          subject: dto.subject,
          content: dto.content,
        },
      });
  
    //   // 4) timeline (audit)
    //   await this.prisma.enquiryTimeline.create({
    //     data: {
    //       enquiryId: enquiry.id,
    //       type: 'CREATED',
    //       createdBy: 'SYSTEM',
    //     },
    //   });
  
      // 5) mark idempotency completed (exactly-once effect)
      
  
      return enquiry;
      
    })
    }
}