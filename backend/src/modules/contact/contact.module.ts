import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
// import { ContactController } from './contact.controller';

@Module({
  controllers: [],
  providers: [ContactService],
  exports: [ContactService], // Exported so Ingestion + Enquiry modules can use it
})
export class ContactModule {}