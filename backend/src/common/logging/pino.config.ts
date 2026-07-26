// pino.config.ts — builds the nestjs-pino Params used by LoggerModule.forRootAsync().
//
// Development: `nest start --watch` recompiles on every save and floods the terminal with
// compiler output, so request/app logs go to a local file (logs/app.log) instead of stdout —
// that's the only place they're actually readable during development.
// Production: plain JSON to stdout, untouched — the hosting platform (CloudWatch, Railway,
// Render, etc.) captures container stdout as the log source, no transport needed.

import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { Params } from 'nestjs-pino';

export function createPinoParams(config: ConfigService, cls: ClsService): Params {
  const isDev = config.get<string>('NODE_ENV', 'production') !== 'production';

  const pinoHttp: Params['pinoHttp'] = {
    level: isDev ? 'debug' : 'info',
    autoLogging: true,
    customProps: () => ({ requestId: cls.getId() }),
  };

  if (!isDev) {
    return { pinoHttp };
  }

  const logsDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return {
    pinoHttp: {
      ...pinoHttp,
      transport: {
        target: 'pino-pretty',
        options: {
          destination: path.join(logsDir, 'app.log'),
          mkdir: true,
          colorize: false,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          singleLine: true,
        },
      },
    },
  };
}
