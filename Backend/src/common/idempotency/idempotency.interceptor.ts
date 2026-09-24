import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AuthUser } from '../auth/auth.decorators';
import { DomainError } from '../errors/domain-error';
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyService } from './idempotency.service';

export const IDEMPOTENT_KEY = 'idempotency:required';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Marks a mutating money endpoint: requires an Idempotency-Key header and replays safely. */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'Unique key (8-128 chars, [A-Za-z0-9_.:-]) per logical operation. Retries with the same key and payload replay the original response.',
    }),
  );

/** Read the validated key in controllers (to thread it into the ledger as external_ref). */
export function idempotencyKeyOf(req: Request): string {
  return String(req.headers[IDEMPOTENCY_HEADER]);
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
    @InjectPinoLogger(IdempotencyInterceptor.name) private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
    if (!required || context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthUser }>();
    const res = http.getResponse<Response>();

    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || key.length === 0) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new DomainError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8-128 chars of [A-Za-z0-9_.:-]');
    }
    const scope = req.user?.id ?? 'anonymous';
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;

    return from(this.idempotency.begin({ scope, key, method: req.method, path, body: req.body })).pipe(
      mergeMap((outcome) => {
        if (outcome.kind === 'replay') {
          this.logger.info({ key }, 'Idempotent replay');
          res.status(outcome.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(outcome.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.idempotency.complete(outcome.recordId, res.statusCode, body);
            return body;
          }),
          catchError((err: unknown) =>
            from(this.idempotency.release(outcome.recordId)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }
}
