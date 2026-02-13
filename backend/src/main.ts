import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ─── API Versioning ────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

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

  // ─── Global Filters & Interceptors ─────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());
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
  await app.listen(port);

  console.log(`\n🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs\n`);
}
bootstrap();
