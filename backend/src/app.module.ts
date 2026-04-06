import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EnquiryModule } from './modules/enquiry/enquiry.module';
import { IngestionModule } from './modules/Ingestion/ingestion.module';
import { QualificationModule } from './modules/qualification/qualification.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { WebhookModule } from './modules/webhooks/webhook.module';
import { CaslModule } from './modules/casl/casl.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ContactModule } from './modules/contact/contact.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PlaygroundModule } from './modules/messaging/messaging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // ── Event System (for enquiry.qualified events) ──
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // ── BullMQ Queue System ──
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),

    PrismaModule,
    AuthModule,
    UserModule,
    PlaygroundModule,
    IngestionModule,
    EnquiryModule,
    QualificationModule,
    CaslModule,
    ContactModule,
    WebhookModule,
    OutboundModule,
    PermissionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdempotencyMiddleware).forRoutes('webhook');
  }
}