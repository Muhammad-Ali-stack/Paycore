import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';

export const CORRELATION_HEADER = 'x-correlation-id';
const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuse an inbound correlation id when it is well-formed, otherwise mint one. */
export function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers[CORRELATION_HEADER];
  const id = typeof inbound === 'string' && VALID_CORRELATION_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

/**
 * Build the pino logger module. Must be CALLED from AppModule's decorator (not at import time):
 * nestjs-pino registers one provider per @InjectPinoLogger() context that exists when
 * forRootAsync() runs, so every feature module has to be loaded first.
 */
export function createLoggingModule(): DynamicModule {
  return LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: resolveCorrelationId,
          customProps: (req: IncomingMessage) => ({ correlationId: (req as IncomingMessage & { id?: unknown }).id }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.newPassword',
              'req.body.pin',
              'req.body.newPin',
              'req.body.currentPin',
              'req.body.refreshToken',
              'req.body.code',
              '*.password',
              '*.pin',
              '*.refreshToken',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
              : undefined,
        },
      }),
    });
}
