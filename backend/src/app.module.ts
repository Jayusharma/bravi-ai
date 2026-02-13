import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EnquiryModule } from './modules/enquiry/enquiry.module';
import { IngestionModule } from './modules/Ingestion/ingestion.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { WebhookModule } from './modules/webhooks/webhook.module';
import { PermissionModule } from './modules/permission/permission.module';
import { PermissionGuard } from './modules/permission/permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    EnquiryModule,
    IngestionModule,
    WebhookModule,
    PermissionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global JWT guard — runs first, authenticates the user
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Permission guard — runs second, checks DB permissions
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdempotencyMiddleware).forRoutes('webhook');
  }
}
