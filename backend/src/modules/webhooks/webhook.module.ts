import { Module } from '@nestjs/common';
import  {IngestionService} from "../Ingestion/ingestion.service";
import { EnquiryModule } from '../enquiry/enquiry.module';
import { EnquiryService } from '../enquiry/enquiry.service';
import { EmailWebhookController } from './webhook.controller';

@Module({
  imports: [],
  controllers: [EmailWebhookController],
  providers: [IngestionService , EnquiryService ],
})
export class WebhookModule {}
