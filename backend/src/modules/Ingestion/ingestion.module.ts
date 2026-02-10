import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import  {IngestionService} from "./ingestion.service";
import { EnquiryModule } from '../enquiry/enquiry.module';
import { EnquiryService } from '../enquiry/enquiry.service';

@Module({
  imports: [],
  controllers: [IngestionController],
  providers: [IngestionService , EnquiryService],
})
export class IngestionModule {}
