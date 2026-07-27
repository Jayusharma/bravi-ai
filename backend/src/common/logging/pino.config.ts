// pino.config.ts — builds the nestjs-pino Params used by LoggerModule.forRootAsync().
//
// Development: logs go to BOTH the terminal (colorized, like before) AND a local file
// (logs/app.log, plain — easier to grep/scroll back through than the watch-mode terminal).
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
    // Trim the req/res objects to what's actually useful — pino-http's defaults dump every
    // header (including Authorization) into every line, which is both noisy and a credential
    // leak into log files. responseTime is already added separately by pino-http itself.
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    // Belt-and-suspenders: redact these paths anywhere they appear in a log line, not just
    // in the auto request/response log (e.g. if a handler ever logs headers directly).
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[Redacted]',
    },
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
        targets: [
          {
            target: 'pino-pretty',
            level: 'debug',
            options: {
              destination: 1, // stdout — same terminal output as before
              colorize: true,
              translateTime: 'yyyy-mm-dd HH:MM:ss',
              singleLine: true,
            },
          },
          {
            target: 'pino-pretty',
            level: 'debug',
            options: {
              destination: path.join(logsDir, 'app.log'),
              mkdir: true,
              colorize: false,
              translateTime: 'yyyy-mm-dd HH:MM:ss',
              singleLine: true,
            },
          },
        ],
      },
    },
  };
}
