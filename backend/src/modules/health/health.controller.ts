// health.controller.ts — GET /ready: readiness probe.
//
// Distinct from GET /health (app.controller.ts), which only confirms the Node process
// itself is alive (uptime, timestamp) — that's a LIVENESS check: if it fails, the
// process is broken and should be restarted. /ready answers a different question: can
// this instance actually serve traffic RIGHT NOW? A perfectly alive process with a dead
// DB connection should fail /ready (take it out of load-balancer rotation) without
// being restarted (restarting won't fix a DB outage).
//
// Uses @Res() to set the status code directly (200 vs 503) instead of throwing an
// HttpException — a failed readiness check is expected, ongoing infra state (DB
// restarting, Redis failing over), not an application bug. Throwing would route it
// through GlobalExceptionFilter, which sends every 5xx to Sentry — that's right for
// real bugs, but would spam Sentry with a duplicate event on every poll for the entire
// duration of an outage k8s/uptime tooling is already alerting on separately.

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { Public } from 'src/common/decorator/public.decorator';
import { PrismaService } from 'src/database/prisma.service';
import { ConnectionStatus } from '@prisma/client';

type CheckStatus = 'up' | 'down';

@Controller()
export class HealthController {
  // One long-lived connection, reused across every /ready call — not opened/closed
  // per request. lazyConnect: only actually connects on the first .ping() call, not
  // at app boot, so a Redis outage at startup doesn't block the server from listening.
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  @Get('ready')
  @Public()
  async ready(@Res() res: Response) {
    const checks: Record<string, CheckStatus> = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
    };

    const allUp = Object.values(checks).every((status) => status === 'up');

    // Informational only — an unconfigured channel doesn't fail readiness, the app
    // serves HTTP fine either way. Just useful to see at a glance which channels this
    // instance thinks are live.
    const activeChannels = await this.prisma.channelConnection.findMany({
      where: { status: ConnectionStatus.ACTIVE },
      select: { channel: true, provider: true },
    });

    res.status(allUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: allUp ? 'ready' : 'not_ready',
      checks,
      channels: activeChannels.map((c) => `${c.channel}:${c.provider}`),
      timestamp: new Date().toISOString(),
    });
  }

  private async checkDatabase(): Promise<CheckStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckStatus> {
    try {
      await this.redis.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
