import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger as NestLogger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, type ErrorCode } from '@flight13/shared';

/**
 * Every error leaves the API as `{ error: { code, message, details?, requestId } }`
 * (`ApiErrorBody` in @flight13/shared). The requestId is echoed in the response
 * header and attached to logs so a support ticket can be traced end-to-end.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly log = new NestLogger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId =
      (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
      randomUUID();

    let status: number;
    let code: ErrorCode | string;
    let message: string;
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = statusCodeToCode(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const payload = body as { message?: string | string[]; error?: unknown };
        message = Array.isArray(payload.message)
          ? payload.message.join('; ')
          : (payload.message ?? exception.message);
        details = payload.message;
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = ERROR_CODES.INTERNAL_ERROR;
      message = 'An unexpected error occurred';
      this.log.error(
        `unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (status >= 500) {
      this.log.error(`${code} ${req.method} ${req.url} → ${status}: ${message}`);
    }

    res.setHeader('x-request-id', requestId);
    res
      .status(status)
      .json({ error: { code, message, ...(details ? { details } : {}), requestId } });
  }
}

function statusCodeToCode(status: number): ErrorCode | string {
  switch (status) {
    case 400:
      return ERROR_CODES.BAD_REQUEST;
    case 401:
      return ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 422:
      return ERROR_CODES.VALIDATION_ERROR;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.BAD_REQUEST;
  }
}
