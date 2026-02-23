import { Module } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [ContactModule],
  providers: [EnquiryService],
  controllers: [EnquiryController],
  exports: [EnquiryService], // Used by IngestionModule
})
export class EnquiryModule { }
