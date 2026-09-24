import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { toErrorResponse } from './error-response';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: unknown }>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toErrorResponse(exception, req.id ? String(req.id) : undefined);

    if (status >= 500) {
      this.logger.error({ err: exception, path: req.url }, 'Unhandled error');
    } else {
      this.logger.info({ code: body.error.code, status, path: req.url }, body.error.message);
    }
    if (!res.headersSent) res.status(status).json(body);
  }
}
