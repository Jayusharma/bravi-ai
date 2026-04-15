import { Controller, Get, Query, Res, ForbiddenException  , Post , Req } from '@nestjs/common';
import type { Response , Request } from 'express';
import { Public } from 'src/common/decorator/public.decorator';
import { ConfigService } from '@nestjs/config';
import { IngestionService } from '@/modules/Ingestion/ingestion.service';

@Public()
@Controller('webhook')
export class WebhookController {
  private readonly verifyToken: string;

  constructor(
    private IngestionService: IngestionService,
    private config: ConfigService,
  ) {}

 @Post("whatsapp")
handleIncoming(@Req() req:Request) {
  console.log(req.body);
}
}
