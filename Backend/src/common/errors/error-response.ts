import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, ErrorCode } from './domain-error';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Translate any thrown value into a stable HTTP status + error body. */
export function toErrorResponse(exception: unknown, correlationId?: string): { status: number; body: ErrorBody } {
  const make = (status: number, code: string, message: string, details?: unknown) => ({
    status,
    body: { error: { code, message, ...(details !== undefined ? { details } : {}), correlationId } },
  });

  if (exception instanceof DomainError) {
    return make(exception.status, exception.code, exception.message, exception.details);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'ERROR');
    if (typeof response === 'object' && response !== null) {
      const r = response as { message?: unknown };
      if (Array.isArray(r.message)) return make(status, code, 'Request validation failed', r.message);
      if (typeof r.message === 'string') return make(status, code, r.message);
    }
    return make(status, code, exception.message);
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return make(HttpStatus.CONFLICT, 'CONFLICT', 'Resource already exists');
    if (isRetryableTxError(exception)) {
      return make(HttpStatus.CONFLICT, 'CONCURRENT_MODIFICATION', 'Concurrent modification, please retry');
    }
    if (exception.code === 'P2025') return make(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Resource not found');
  }

  return make(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Internal server error');
}

function pgCodeOf(e: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = e.meta as { code?: unknown } | undefined;
  return typeof meta?.code === 'string' ? meta.code : undefined;
}

/** Serialization failures and deadlocks: safe to retry the whole transaction. */
export function isRetryableTxError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2034') return true;
    const pg = pgCodeOf(e);
    if (pg === '40001' || pg === '40P01') return true;
  }
  // Raw-query and commit-time failures don't always carry a structured code.
  return (
    (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) &&
    /could not serialize access|deadlock detected|\b40001\b|\b40P01\b/i.test(e.message)
  );
}

export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  if (!field) return true;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.some((t) => String(t).includes(field));
  return typeof target === 'string' ? target.includes(field) : false;
}
