import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Response Interceptor
 *
 * Wraps all successful responses in a standardized format:
 * {
 *   success: true,
 *   data: { ... },
 *   timestamp: "2026-02-12T..."
 * }
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((data) => ({
                success: true,
                data,
                timestamp: new Date().toISOString(),
            })),
        );
    }
}
