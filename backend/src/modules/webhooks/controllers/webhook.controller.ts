import { Controller, Get, Query, Res, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from 'src/common/decorator/public.decorator';
import { ConfigService } from '@nestjs/config';

@Public()
@Controller('webhook')
export class WebhookController {
  private readonly verifyToken: string;

  constructor(
    private config: ConfigService,
  ) {
    this.verifyToken = this.config.getOrThrow('WHATSAPP_VERIFY_TOKEN');
  }

  @Get('whatsapp')
verify(
  @Query('hub.mode') mode: string,
  @Query('hub.verify_token') verifyToken: string,
  @Query('hub.challenge') challenge: string,
  @Res() res: Response,
) {
  if (mode === 'subscribe' && verifyToken === this.verifyToken) {
    console.log('✅ WhatsApp webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.log('❌ WhatsApp verification failed');
  return res.sendStatus(403);
}
}
