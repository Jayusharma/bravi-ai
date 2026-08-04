// health.module.ts — no providers to register. PrismaService comes from the global
// PrismaModule, ConfigService from the global ConfigModule — both already app-wide.
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
