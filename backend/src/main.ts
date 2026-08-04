import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RedisIoAdapter } from './adapters/redis-io.adapter';

// This ONLY configures the Sentry client (where events go, under what environment tag).
// It does not install any error handler, middleware, or auto-instrumentation by itself —
// nothing gets sent to Sentry until something explicitly calls Sentry.captureException().
// The only place that happens in this backend is GlobalExceptionFilter's 5xx branch
// (common/filters/global-exception.filter.ts) — deliberately, so there's exactly one
// call site to reason about instead of errors surfacing from scattered auto-instrumentation.
// No DSN (e.g. local dev) → Sentry silently no-ops; nothing crashes, nothing sends.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });

  // Switch Nest's own logger (and every `new Logger(name)` call site app-wide) to pino,
  // as early as possible — bufferLogs above holds Nest's bootstrap logs until this runs.
  app.useLogger(app.get(Logger));

  // ─── Security headers ──────────────────────────────────────────
  // Sets response headers only (X-Content-Type-Options, X-Frame-Options, etc.) — no
  // request counting, no risk of blocking a legitimate caller. Safe on every route,
  // unlike rate limiting which is deliberately scoped to public routes only.
  app.use(helmet());

  // ─── API Versioning ────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Redis Socket.IO Adapter (horizontal scaling) ─────────────
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(
    process.env.REDIS_HOST || 'localhost',
    parseInt(process.env.REDIS_PORT || '6379', 10),
  );
  app.useWebSocketAdapter(redisIoAdapter);

  // ─── CORS ──────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // ─── Global Pipes ──────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ─── Global Interceptors ────────────────────────────────────────
  // GlobalExceptionFilter is registered via APP_FILTER in app.module.ts (needs DI
  // for ClsService, to attach requestId to error responses).
  app.useGlobalInterceptors(new ResponseInterceptor());

  // ─── Swagger / OpenAPI Documentation ──────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Enquiry Management System API')
    .setDescription(
      'Enterprise-grade enquiry management with multi-channel ingestion, ' +
      'AI qualification, automation, and DB-driven permissions.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // ─── Start ─────────────────────────────────────────────────────
  const port = process.env.PORT ?? 3001;
  await app.listen(port, "0.0.0.0");

  console.log(`\n🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs\n`);
}
bootstrap();
