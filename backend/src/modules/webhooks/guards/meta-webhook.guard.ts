import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelProvider } from '@prisma/client';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { ChannelsService } from '@/modules/channels/channels.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class MetaWebhookGuard implements CanActivate {
  private readonly logger = new Logger(MetaWebhookGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly channelsService: ChannelsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.log('🌐 [MetaWebhookGuard] Inbound POST request received from Meta/Client');

    // 1️⃣ Primary source: resolve appSecret from the connected DB channel
    const connection = await this.channelsService.findConnectionForProvider(ChannelProvider.META_WHATSAPP);
    let appSecret = connection ? this.channelsService.resolveMetaCredentials(connection).appSecret : undefined;

    // 2️⃣ Secondary fallback: check process.env / ConfigService
    if (!appSecret) {
      appSecret = this.configService.get<string>('META_APP_SECRET');
    }

    // If no app secret is configured, log warning and allow (for local sandbox/dev testing)
    if (!appSecret) {
      this.logger.warn(
        '⚠️ META_APP_SECRET is not configured in DB or .env. Meta webhook signature verification skipped.',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    if (!signature) {
      this.logger.warn('🚫 Meta webhook missing X-Hub-Signature-256 header');
      throw new ForbiddenException('Missing Meta webhook signature');
    }

    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      this.logger.warn(`🚫 Meta webhook invalid signature format: "${signature}"`);
      throw new ForbiddenException('Invalid signature format');
    }

    const signatureHash = parts[1];
    const rawBody = request.rawBody || Buffer.from(JSON.stringify(request.body || {}));

    const hmac = crypto.createHmac('sha256', appSecret);
    const expectedHash = hmac.update(rawBody).digest('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'utf8');
    const signatureBuffer = Buffer.from(signatureHash, 'utf8');

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      this.logger.warn(
        `🚫 HMAC Mismatch! Expected: "${expectedHash.substring(0, 10)}...", Received: "${signatureHash.substring(0, 10)}..."`,
      );
      throw new ForbiddenException('Invalid Meta signature');
    }

    this.logger.log('✅ HMAC Signature Verified! Signature matches Meta App Secret.');
    return true;
  }
}
