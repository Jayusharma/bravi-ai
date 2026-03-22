import { Module, forwardRef } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [forwardRef(() => ContactModule)],
  providers: [EnquiryService],
  controllers: [EnquiryController],
  exports: [EnquiryService],
})
export class EnquiryModule { }
