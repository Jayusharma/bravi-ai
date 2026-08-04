import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './common/config/env.schema';
import { ClsModule, ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { createPinoParams } from './common/logging/pino.config';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EnquiryModule } from './modules/enquiry/enquiry.module';
import { IngestionModule } from './modules/Ingestion/ingestion.module';
import { QualificationModule } from './modules/qualification/qualification.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { WebhookModule } from './modules/webhooks/webhook.module';
import { CaslModule } from './modules/casl/casl.module';
import { CaslGuard } from './modules/casl/casl.guard';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContactModule } from './modules/contact/contact.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { PermissionModule } from './modules/permission/permission.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { WebsocketModule } from './websocket/websocket.module';
import { EventsModule } from './events/events.module';
import { SearchModule } from './modules/search/search.module';
import { TemplateModule } from './modules/template/template.module';
import { ChatModule } from './modules/chat/chat.module';
import { AIModule } from './ai/ai.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // ── Request-scoped context (requestId, and anything a handler wants to stamp
    //    onto it — e.g. contactId/channelConnectionId) — must come before LoggerModule
    //    so its middleware has already run by the time pino-http builds its log line.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => (req.headers['x-request-id'] as string) || randomUUID(),
      },
    }),

    // ── Structured logging (nestjs-pino) — see common/logging/pino.config.ts for the
    //    dev-file-vs-prod-stdout split. app.useLogger() in main.ts redirects every
    //    `new Logger(name)` call site in the app through this, no per-file migration.
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, ClsService],
      useFactory: createPinoParams,
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

    // ── Rate limiting — config only, NOT a global guard (see AuthModule/WebhookModule/
    //    OutboundModule for where ThrottlerGuard is actually applied). Public routes only,
    //    by explicit design: an authenticated abuser is a CASL/audit problem, not a
    //    rate-limit one. This default (10/min) only matters if a route opts in with
    //    @UseGuards(ThrottlerGuard) and doesn't override it with its own @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),

    PrismaModule,
    AuthModule,
    UserModule,
    MessagingModule,
    IngestionModule,
    EnquiryModule,
    QualificationModule,
    CaslModule,
    ContactModule,
    WebhookModule,
    OutboundModule,
    PermissionModule,
    WebsocketModule,
    EventsModule,
    SearchModule,
    TemplateModule,
    ChatModule,
    AIModule,
    AutomationModule,
    ChannelsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: JwtAuthGuard runs first (populates request.user), then CaslGuard.
    // CaslGuard is now global — it enforces every @CheckAbility() decorator app-wide,
    // so a controller can never ship without permission checks by omission again.
    // Routes with no @CheckAbility (including every @Public() route) are unaffected —
    // see CaslGuard.canActivate(), which returns true before it ever looks at request.user
    // when no ability metadata is present on the handler.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CaslGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdempotencyMiddleware).forRoutes('webhook');
  }
}