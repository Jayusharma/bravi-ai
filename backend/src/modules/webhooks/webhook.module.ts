import { Module } from '@nestjs/common';
import { IngestionModule } from '../Ingestion/ingestion.module';
import { WebhookController } from './webhook.controller';
import { TwilioWhatsAppNormalizer } from './normalizer/twilio-whatsapp.normalizer';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';
import { MetaWhatsAppNormalizer } from './normalizer/meta-whatsapp.normalizer';
import { ChannelsModule } from '../channels/channels.module';


@Module({
  imports: [
    IngestionModule,  // Provides IngestionService
    ChannelsModule,   // Provides ChannelsService — the on/off gate for inbound email
  ],
  controllers: [WebhookController],
  providers: [
    TwilioWhatsAppNormalizer,
    SendGridEmailNormalizer,
    MetaWhatsAppNormalizer,
  ],
})
export class WebhookModule { }
