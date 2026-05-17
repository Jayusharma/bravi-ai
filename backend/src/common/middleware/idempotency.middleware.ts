import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const body: any = req.body;

    if (body?.MessageSid) {
      req.headers['x-idempotency-key'] = `WHATSAPP:${body.MessageSid}`;
      return next();
    }

    const messageId = this.extractEmailMessageId(body?.headers);
    if (messageId) {
      req.headers['x-idempotency-key'] = `EMAIL:${messageId}`;
      return next();
    }

    if (body?.from && (body?.text || body?.html)) {
      const fingerprint = createHash('sha256')
        .update(
          [
            String(body.from).trim().toLowerCase(),
            String(body.to || '').trim().toLowerCase(),
            String(body.subject || '').trim(),
            String(body.text || body.html || '').trim(),
          ].join('|'),
        )
        .digest('hex');
      req.headers['x-idempotency-key'] = `EMAIL:${fingerprint}`;
      return next();
    }

    if (body?.channel && (body?.externalId || body?.externalMessageId)) {
      const externalId = body.externalId || body.externalMessageId;
      req.headers['x-idempotency-key'] = `${body.channel}:${externalId}`;
    }

    next();
  }

  private extractEmailMessageId(headers?: string): string | null {
    const match = headers?.match(/Message-ID:\s*<(.+?)>/i);
    return match ? match[1].trim() : null;
  }
}
