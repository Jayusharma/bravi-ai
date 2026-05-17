import { Module } from '@nestjs/common';
import { IngestionModule } from '../Ingestion/ingestion.module';
import { WebhookController } from './webhook.controller';
import { TwilioWhatsAppNormalizer } from './normalizer/twilio-whatsapp.normalizer';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';


@Module({
  imports: [
    IngestionModule,  // Provides IngestionService
  ],
  controllers: [WebhookController],
  providers: [
    TwilioWhatsAppNormalizer,
    SendGridEmailNormalizer,
  ],
})
export class WebhookModule { }
