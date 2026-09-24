import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfig } from '../../config/app-config';
import { DomainError } from '../errors/domain-error';
import { isUniqueViolation } from '../errors/error-response';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalJson, sha256, toJsonSafe } from '../util/crypto';
import { addSeconds } from '../util/time';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Body fields that must not influence the fingerprint (secrets that the client may re-type). */
const EXCLUDED_FIELDS = new Set(['pin']);

export interface BeginInput {
  scope: string;
  key: string;
  method: string;
  path: string;
  body: unknown;
}

export type BeginOutcome =
  | { kind: 'execute'; recordId: string }
  | { kind: 'replay'; status: number; body: unknown };

export function requestFingerprint(method: string, path: string, body: unknown): string {
  const cleaned =
    body && typeof body === 'object' && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => !EXCLUDED_FIELDS.has(k)))
      : body ?? null;
  return sha256(canonicalJson({ method: method.toUpperCase(), path, body: cleaned }));
}

/**
 * Idempotency-Key semantics:
 *  - first request with a key claims it (IN_PROGRESS, with a lease) and executes;
 *  - success stores the response; later requests with the same key + same payload replay it;
 *  - same key + different payload => 422; concurrent duplicate while executing => 409;
 *  - failure releases the key so the client can retry (no money moved on failure);
 *  - an expired lease (crashed worker) can be taken over. Double-posting in that edge case
 *    is still impossible because journal entries carry the key as a unique external_ref.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async begin(input: BeginInput, attempt = 0): Promise<BeginOutcome> {
    const now = new Date();
    const requestHash = requestFingerprint(input.method, input.path, input.body);
    try {
      const record = await this.prisma.idempotencyRecord.create({
        data: {
          scope: input.scope,
          key: input.key,
          requestMethod: input.method.toUpperCase(),
          requestPath: input.path,
          requestHash,
          lockedUntil: addSeconds(now, this.config.get('IDEMPOTENCY_LOCK_SECONDS')),
          expiresAt: addSeconds(now, this.config.get('IDEMPOTENCY_TTL_SECONDS')),
        },
        select: { id: true },
      });
      return { kind: 'execute', recordId: record.id };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope: input.scope, key: input.key } },
    });
    if (!existing || existing.expiresAt <= now) {
      if (existing) await this.prisma.idempotencyRecord.deleteMany({ where: { id: existing.id, expiresAt: { lte: now } } });
      if (attempt >= 2) throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'Request with this key is in progress');
      return this.begin(input, attempt + 1);
    }

    if (existing.requestHash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    }
    if (existing.status === 'COMPLETED') {
      return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
    }
    if (existing.lockedUntil > now) {
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
    }

    // Stale lease: take it over atomically (compare-and-set on lockedUntil).
    const taken = await this.prisma.idempotencyRecord.updateMany({
      where: { id: existing.id, status: 'IN_PROGRESS', lockedUntil: existing.lockedUntil },
      data: { lockedUntil: addSeconds(now, this.config.get('IDEMPOTENCY_LOCK_SECONDS')) },
    });
    if (taken.count !== 1) {
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
    }
    return { kind: 'execute', recordId: existing.id };
  }

  async complete(recordId: string, status: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status: 'COMPLETED',
        responseStatus: status,
        responseBody: toJsonSafe(body) as Prisma.InputJsonValue,
      },
    });
  }

  async release(recordId: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { id: recordId, status: 'IN_PROGRESS' } });
  }

  /** Housekeeping; call from a scheduler/cron. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return count;
  }
}
