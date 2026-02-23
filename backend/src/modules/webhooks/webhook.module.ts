import { Module } from '@nestjs/common';
import  {IngestionService} from "../Ingestion/ingestion.service";
import { EnquiryModule } from '../enquiry/enquiry.module';
import { EnquiryService } from '../enquiry/enquiry.service';
import { WebhookController } from './controllers/webhook.controller';

@Module({
  imports: [],
  controllers: [WebhookController],
  providers: [ EnquiryService ],
})
export class WebhookModule {}
