import { Module } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';

@Module({
  providers: [EnquiryService],
  controllers: [EnquiryController]
})
export class EnquiryModule {}
