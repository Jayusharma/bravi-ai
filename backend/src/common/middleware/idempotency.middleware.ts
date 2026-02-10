
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const body: any = req.body;

   

    // Only for ingestion routes
    
      if (body?.channel && body?.externalMessageId) {
        req.headers['x-idempotency-key'] =
          `${body.channel}:${body.externalMessageId}`;
      }

      next();
    };

 
  }

