import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { INestApplication, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';

/**
 * Redis-backed Socket.IO adapter.
 *
 * WHY: The default in-memory adapter means socket.to(room).emit()
 * only reaches clients connected to the SAME server instance.
 * Under horizontal scaling (2+ NestJS instances behind a load balancer),
 * delivery updates would silently drop for 50% of users.
 *
 * This adapter uses Redis pub/sub so any instance can broadcast to
 * any room regardless of which instance holds the WebSocket connection.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(host: string, port: number): Promise<void> {
    const pubClient = new Redis({ host, port, maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) =>
      this.logger.error(`Redis pub client error: ${err.message}`),
    );
    subClient.on('error', (err) =>
      this.logger.error(`Redis sub client error: ${err.message}`),
    );

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(`✅ Redis Socket.IO adapter connected to ${host}:${port}`);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
