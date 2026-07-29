import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  Injectable,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { Prisma } from '@prisma/client';

/**
 * Global Exception Filter — catches everything an HTTP handler throws (or fails to
 * catch) and turns it into one consistent response shape:
 *   { success: false, error: { code, message, statusCode, requestId, details? },
 *     timestamp, path }
 *
 * Branch order matters: HttpException and Prisma's known-error class both extend
 * Error, so they're checked BEFORE the generic Error branch, most-specific first.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly cls: ClsService) {}

  // ── Branch 1: Nest's own exceptions ──────────────────────────────────────
  // NotFoundException, BadRequestException, ForbiddenException, etc. — all
  // deliberately thrown by our own code, already carrying a real status + message.
  private classifyHttpException(exception: HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();

    // rare: `new HttpException('plain string', code)` thrown directly
    if (typeof response === 'string') {
      return {
        status,
        code: exception.constructor.name,
        message: response,
        details: undefined,
      };
    }

    const body = response as { message?: string | string[] };

    // class-validator failed multiple fields at once — keep them as separate items,
    // never flatten into one string, so the frontend can show one error per field
    if (Array.isArray(body.message)) {
      return {
        status,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: body.message,
      };
    }

    return {
      status,
      code: exception.constructor.name,
      message: body.message ?? 'An error occurred',
      details: undefined,
    };
  }

  // ── Branch 2: Prisma's known database errors ─────────────────────────────
  // Nobody wrote an `if` for these — Prisma itself refused the operation because
  // it broke a database rule (unique constraint, missing row, bad foreign key).
  private classifyPrismaException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        const field = (exception.meta?.target as string[])?.[0] ?? 'field';
        return {
          status: 409,
          code: 'DUPLICATE_ENTRY',
          message: `A record with this ${field} already exists`,
          details: undefined,
        };
      }
      case 'P2025':
        return {
          status: 404,
          code: 'RECORD_NOT_FOUND',
          message: 'Record not found',
          details: undefined,
        };
      case 'P2003':
        return {
          status: 400,
          code: 'INVALID_REFERENCE',
          message: 'Related record does not exist',
          details: undefined,
        };
      default:
        // known-error class, but a code we haven't specifically mapped — stay generic,
        // never pass exception.message through, it can contain raw SQL/table names
        return {
          status: 500,
          code: 'DATABASE_ERROR',
          message: 'A database error occurred',
          details: undefined,
        };
    }
  }

  // ── Branch 3: genuine unexpected errors ──────────────────────────────────
  // A real bug (null we forgot to guard, a library throwing its own error), or a
  // plain `throw new Error(...)` used where a real HttpException should've been
  // thrown instead. Full stack goes to the log only — never to the client.
  private classifyGenericError(exception: Error) {
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      details: undefined,
      _stackForLogging: exception.stack,
    };
  }

  // ── Main entry point — Nest routes every unhandled throw here ───────────
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = this.cls.getId();

    let result: {
      status: number;
      code: string;
      message: string;
      details?: unknown;
      _stackForLogging?: string;
    };

    if (exception instanceof HttpException) {
      result = this.classifyHttpException(exception);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      result = this.classifyPrismaException(exception);
    } else if (exception instanceof Error) {
      result = this.classifyGenericError(exception);
    } else {
      // thrown a raw string/object, not even an Error instance — genuinely rare
      result = {
        status: 500,
        code: 'UNKNOWN_ERROR',
        message: 'Something went wrong. Please try again.',
      };
    }

    // ── Log every branch — this was the bug before: only raw Error logged anything ──
    const logContext = { requestId, path: request.url, method: request.method };

    if (result.status >= 500) {
      this.logger.error(
        { ...logContext, stack: result._stackForLogging },
        result.message,
      );
    } else {
      this.logger.warn(logContext, result.message);
    }

    // ── One consistent response shape, every branch, every time ─────────────
    response.status(result.status).json({
      success: false,
      error: {
        code: result.code,
        message: result.message,
        statusCode: result.status,
        requestId,
        details: result.details,
        // _stackForLogging deliberately excluded — logging only, never leaves the server
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}