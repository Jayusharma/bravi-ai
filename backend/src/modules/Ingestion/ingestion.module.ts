import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'qualification',
    }),
    ContactModule
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}