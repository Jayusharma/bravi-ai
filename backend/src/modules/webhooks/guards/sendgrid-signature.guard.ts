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
export class SendGridSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SendGridSignatureGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly channelsService: ChannelsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.log('🌐 [SendGridSignatureGuard] Inbound Email POST request received');

    // 1️⃣ Primary source: resolve verificationKey from connected DB channel connection
    const connection = await this.channelsService.findConnectionForProvider(ChannelProvider.SENDGRID_EMAIL);
    let publicKey = connection
      ? this.channelsService.resolveSendGridCredentials(connection)?.verificationKey
      : undefined;

    // 2️⃣ Secondary fallback: check process.env / ConfigService
    if (!publicKey) {
      publicKey = this.configService.get<string>('SENDGRID_VERIFICATION_KEY');
    }

    // If SENDGRID_VERIFICATION_KEY is not configured, log a warning and pass (for dev/local testing)
    if (!publicKey) {
      this.logger.warn(
        '⚠️ SENDGRID_VERIFICATION_KEY is not configured in DB or .env. SendGrid signature verification skipped.',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const signature = request.headers['x-twilio-email-event-webhook-signature'] as string | undefined;
    const timestamp = request.headers['x-twilio-email-event-webhook-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      this.logger.warn('🚫 SendGrid webhook missing X-Twilio-Email-Event-Webhook-Signature or Timestamp header');
      throw new ForbiddenException('Missing SendGrid signature headers');
    }

    const rawBody = request.rawBody || Buffer.from(JSON.stringify(request.body || {}));
    const payloadToVerify = Buffer.concat([Buffer.from(timestamp), rawBody]);

    try {
      const verify = crypto.createVerify('sha256');
      verify.update(payloadToVerify);
      const isValid = verify.verify(publicKey, signature, 'base64');

      if (!isValid) {
        this.logger.warn('🚫 SendGrid webhook signature verification failed');
        throw new ForbiddenException('Invalid SendGrid signature');
      }

      this.logger.log('✅ SendGrid Webhook Signature Verified!');
      return true;
    } catch (err: any) {
      this.logger.warn(`🚫 SendGrid signature validation error: ${err.message}`);
      throw new ForbiddenException('Invalid SendGrid signature');
    }
  }
}
