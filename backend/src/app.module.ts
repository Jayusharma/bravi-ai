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
    WebhookModule

  ],
  controllers: [AppController],
  providers: [AppService , {
    provide: APP_GUARD,
    useClass: JwtAuthGuard,
  }],
})
export class AppModule implements NestModule {

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdempotencyMiddleware).forRoutes('webhook')
  }

}
