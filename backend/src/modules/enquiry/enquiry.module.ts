import { Module } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';

@Module({
  providers: [EnquiryService],
  controllers: [EnquiryController],
  exports: [EnquiryService], // Used by IngestionModule
})
export class EnquiryModule { }
