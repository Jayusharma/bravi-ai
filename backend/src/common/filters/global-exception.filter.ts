import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ClsService } from 'nestjs-cls';

/**
 * Global Exception Filter
 *
 * Catches ALL exceptions and returns a standardized error response format.
 * Maps Prisma errors to user-friendly messages.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger('ExceptionFilter');

    constructor(private readonly cls: ClsService) {}

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();
        const requestId = this.cls.getId();

        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let errorCode = 'INTERNAL_ERROR';
        let details: any = undefined;

        // ─── Handle NestJS HttpException ─────────────────────────────
        if (exception instanceof HttpException) {
            statusCode = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object') {
                const resp = exceptionResponse as any;
                message = resp.message || exception.message;
                errorCode = resp.error || this.getErrorCode(statusCode);
                details = resp.details;

                // class-validator returns message as array
                if (Array.isArray(message)) {
                    details = message;
                    message = 'Validation failed';
                    errorCode = 'VALIDATION_ERROR';
                }
            }
            this.logger.warn(
                `[${requestId}] ${request.method} ${request.url} → ${statusCode} ${errorCode}: ${Array.isArray(message) ? message.join('; ') : message}`,
            );
        }
        // ─── Handle Prisma errors ────────────────────────────────────
        else if (this.isPrismaError(exception)) {
            const prismaResult = this.handlePrismaError(exception);
            statusCode = prismaResult.statusCode;
            message = prismaResult.message;
            errorCode = prismaResult.errorCode;
            this.logger.error(
                `[${requestId}] ${request.method} ${request.url} → ${statusCode} ${errorCode} (Prisma: ${(exception as any)?.code})`,
                (exception as Error)?.stack,
            );
        }
        // ─── Handle unknown errors ───────────────────────────────────
        // The client only ever gets the generic "Internal server error" message above —
        // the real exception.message (which can contain file paths, SQL fragments, or
        // other internals) is logged server-side only, never put in the response body.
        else if (exception instanceof Error) {
            this.logger.error(
                `[${requestId}] ${request.method} ${request.url} → 500 Unhandled: ${exception.message}`,
                exception.stack,
            );
        } else {
            this.logger.error(`[${requestId}] ${request.method} ${request.url} → 500 Unhandled non-Error exception: ${JSON.stringify(exception)}`);
        }

        const errorResponse = {
            success: false,
            error: {
                code: errorCode,
                message,
                statusCode,
                requestId,
                ...(details && { details }),
            },
            timestamp: new Date().toISOString(),
            path: request.url,
        };

        response.status(statusCode).json(errorResponse);
    }

    private getErrorCode(statusCode: number): string {
        const codes: Record<number, string> = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            422: 'UNPROCESSABLE_ENTITY',
            429: 'TOO_MANY_REQUESTS',
            500: 'INTERNAL_ERROR',
        };
        return codes[statusCode] || 'UNKNOWN_ERROR';
    }

    private isPrismaError(exception: any): boolean {
        return exception?.constructor?.name?.startsWith('Prisma') || exception?.code?.startsWith?.('P');
    }

    private handlePrismaError(exception: any): {
        statusCode: number;
        message: string;
        errorCode: string;
    } {
        switch (exception.code) {
            case 'P2002':
                return {
                    statusCode: HttpStatus.CONFLICT,
                    message: `A record with this ${exception.meta?.target?.join(', ') || 'field'} already exists`,
                    errorCode: 'DUPLICATE_ENTRY',
                };
            case 'P2025':
                return {
                    statusCode: HttpStatus.NOT_FOUND,
                    message: 'Record not found',
                    errorCode: 'NOT_FOUND',
                };
            case 'P2003':
                return {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: 'Related record not found — invalid reference',
                    errorCode: 'FOREIGN_KEY_ERROR',
                };
            default:
                return {
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: 'Database error',
                    errorCode: 'DATABASE_ERROR',
                };
        }
    }
}
