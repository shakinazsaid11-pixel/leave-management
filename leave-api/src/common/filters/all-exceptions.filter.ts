import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] =
      'Something went wrong on our side. Please try again in a moment.';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as any).message ?? exception.message);
    } else if (exception instanceof QueryFailedError) {
      // The database refused the change. Turn the rules it enforces into
      // plain sentences; anything we do not recognise stays a generic error.
      const known = this.describeDatabaseError(
        (exception as any).driverError?.code,
      );
      if (known) {
        statusCode = known.statusCode;
        message = known.message;
      }
    }

    // Log what happened so it can be found later. Unexpected failures are
    // logged as errors with the full stack trace. The user still only sees
    // the tidy message below.
    const where = `${request.method} ${request.url}`;
    if (exception instanceof HttpException) {
      if (statusCode >= 500) {
        this.logger.error(`${where} -> ${statusCode}`, exception.stack);
      } else {
        this.logger.warn(
          `${where} -> ${statusCode}: ${JSON.stringify(message)}`,
        );
      }
    } else {
      const error = exception instanceof Error ? exception : undefined;
      this.logger.error(
        `${where} -> ${statusCode}: ${error?.message ?? String(exception)}`,
        error?.stack,
      );
    }

    response.status(statusCode).json({
      success: false,
      error: { statusCode, message },
    });
  }

  // Postgres error codes for the rules the schema enforces.
  private describeDatabaseError(
    code: string | undefined,
  ): { statusCode: number; message: string } | null {
    switch (code) {
      case '23P01': // exclusion violation: overlapping approved leave
        return {
          statusCode: HttpStatus.CONFLICT,
          message:
            'These dates overlap leave that has already been approved for this employee.',
        };
      case 'P0001': // raised by the balance trigger
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            'This employee does not have enough leave days left for this request.',
        };
      case '23514': // check constraint violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            'Some of the details are not allowed. Please check them and try again.',
        };
      case '23503': // foreign key violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            'Some of the details refer to something that does not exist.',
        };
      default:
        return null;
    }
  }
}