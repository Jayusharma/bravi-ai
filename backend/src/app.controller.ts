import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorator/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /health — Health check endpoint.
   * Returns basic system info. Used for uptime monitoring.
   */
  @Get('health')
  @Public()
  healthCheck() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}
