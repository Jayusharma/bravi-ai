import { Injectable , NotFoundException , BadRequestException  , ConflictException , ForbiddenException} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateEnquiryDto  , ChangeStatusDto , SendMessageDto} from './dto/create-enquiry.dto';
import { ENQUIRY_TRANSITIONS } from './enquiry.state';
import { EnquirySource, EnquiryStatus  } from '@prisma/client';
import { automationQueue } from '../automation/automation.queue';
import { canSendMessage } from './policy/enquiry.policy';
import { randomUUID } from 'crypto';


@Injectable()
export class EnquiryService {
    constructor(private prisma:PrismaService){}

    async create(
        dto: CreateEnquiryDto,
        userId?: string,
        key?: string,
      ) {
        const enquiry = await this.prisma.enquiry.create({
          data: {
            ...dto,
            timeline: {
              create: {
                type: 'CREATED',
                createdBy: userId ?? 'SYSTEM',
              },
            },
          },
        });
      
        if (key) {
          await this.prisma.idempotencyKey.update({
            where: { key },
            data: {
              status: 'COMPLETED',
              response: enquiry,
            },
          });
        }
      
        return enquiry;
      }  

      async createFromMessage(param:{
        source: EnquirySource,
        from: string;
      }){
        return this.prisma.enquiry.create({
           data:{
            source: param.source ,
            email: param.source === 'EMAIL' ? param.from : undefined,
            phone: param.source === 'WHATSAPP' ? param.from : undefined,
            timeline:{
              create:{
                type:'CREATED',
                createdBy:'SYSTEM'
              }
            }
          }
        })
      }
    
    async statusChange(id:string,dto:ChangeStatusDto , userId?:string){

        const enquiry = await this.prisma.enquiry.findUnique({
            where: { id }
        })
        

        if(!enquiry){
            throw new NotFoundException('Enquiry not found');
        }

        if (enquiry.version !== dto.version) {
          throw new ConflictException(
            'Enquiry was modified by another user',
          );
        }
           

        const allowedTransitions = ENQUIRY_TRANSITIONS[enquiry.status];
           
        if(!allowedTransitions.includes(dto.status)){
            throw new BadRequestException('Invalid status transition');
        }


        if (dto.status ==="QUOTATION_SENT") {
          console.log('🟡 Scheduling quotation follow-up');
      
          await automationQueue.add(
            'automation',
            { enquiryId: enquiry.id },
            {
              jobId: `followup_${enquiry.id}`,
              delay: 2 * 1000,
              attempts: 3, //max retreis 
              backoff:{
                type:'exponential',
                delay:5000
              }
            },
          );
        } else {
          // Leaving QUOTATION_SENT → cancel follow-up
          await automationQueue.remove(`followup_${enquiry.id}`);
        }

        return this.prisma.enquiry.update({
            where: { id },
            data: { status: dto.status,
                version: { increment: 1 },
                timeline:{
                    create:{
                        type:"STATUS_CHANGED",
                        fromStatus:enquiry.status,
                        toStatus:dto.status,
                        createdBy:userId,
                    }
                }
             }
        })
}

async assign(
  enquiryId: string,
  userId: string,
  version: number,
  
) {
  const enquiry = await this.prisma.enquiry.findUnique({
    where: { id: enquiryId },
  });

  if (!enquiry) {
    throw new NotFoundException('Enquiry not found');
  }

  if (enquiry.version !== version) {
    throw new ConflictException(
      'Enquiry was modified by another user',
    );
  }

  return this.prisma.enquiry.update({
    where: { id: enquiryId },
    data: {
      assignedToId: userId,
      version: { increment: 1 },
      timeline: {
        create: {
          type: 'STATUS_CHANGED',
         
        },
      },
    },
  });
}


async sendMessage(
  enquiryId: string,
  dto: SendMessageDto,
  actor: { userId: string; role: string },
) {
  return this.prisma.$transaction(async (tx) => {
    const enquiry = await tx.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    if (!canSendMessage(actor, enquiry)) {
      throw new ForbiddenException(
        'You are not allowed to send messages for this enquiry',
      );
    }

    const message = await tx.message.create({
      data: {
        enquiryId: enquiry.id,
        direction: 'OUTBOUND',
        channel: 'EMAIL', // future: EMAIL / WHATSAPP
        externalId: `outbound-${randomUUID()}`,
        from: actor.userId,
        content: dto.content,
      },
    });

    await tx.enquiryTimeline.create({
      data: {
        enquiryId: enquiry.id,
        type: 'STATUS_CHANGED',
        createdBy: actor.userId,
      },
    });

    return message;
  });
}


}