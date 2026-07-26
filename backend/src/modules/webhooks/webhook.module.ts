import { Module } from '@nestjs/common';
import { IngestionModule } from '../Ingestion/ingestion.module';
import { WebhookController } from './webhook.controller';
import { SendGridEmailNormalizer } from './normalizer/email.normalizer';
import { MetaWhatsAppNormalizer } from './normalizer/meta-whatsapp.normalizer';
import { ChannelsModule } from '../channels/channels.module';
import { MetaWebhookGuard } from './guards/meta-webhook.guard';
import { SendGridSignatureGuard } from './guards/sendgrid-signature.guard';

@Module({
  imports: [
    IngestionModule,  // Provides IngestionService
    ChannelsModule,   // Provides ChannelsService — the on/off gate for inbound email
  ],
  controllers: [WebhookController],
  providers: [
    SendGridEmailNormalizer,
    MetaWhatsAppNormalizer,
    MetaWebhookGuard,
    SendGridSignatureGuard,
  ],
})
export class WebhookModule { }
