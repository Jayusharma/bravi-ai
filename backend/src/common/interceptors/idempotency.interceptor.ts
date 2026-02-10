import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
  } from '@nestjs/common';
  import { Observable, tap } from 'rxjs';
  import { PrismaService } from 'src/database/prisma.service';
  
  @Injectable()
  export class IdempotencyInterceptor implements NestInterceptor {
    constructor(private prisma: PrismaService) {}
  
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
      const req = ctx.switchToHttp().getRequest();
      const key = req.headers['x-idempotency-key'];
  
      if (!key) {
        return next.handle();
      }
  
      return next.handle().pipe(
        tap(async (response) => {
          // finalize ONLY on success
          await this.prisma.idempotencyKey.update({
            where: { key },
            data: {
              status: 'COMPLETED',
              response,
            },
          });
        }),
      );
    }
  }
  