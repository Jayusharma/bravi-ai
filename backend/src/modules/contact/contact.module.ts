import { Module, forwardRef } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { EnquiryModule } from '../enquiry/enquiry.module';

@Module({
  imports: [forwardRef(() => EnquiryModule)],
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule { }