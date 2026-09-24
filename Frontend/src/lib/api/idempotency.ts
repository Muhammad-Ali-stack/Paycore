/**
 * Idempotency for money actions.
 *
 * - One key per LOGICAL action (created when the confirm sheet opens), reused for
 *   every retry and every double-click, so the backend replays instead of
 *   double-charging.
 * - 409 IDEMPOTENCY_IN_PROGRESS means "the first attempt is still running": wait
 *   and retry with the same key until it settles.
 * - Network errors / 5xx are retried with the same key (safe by construction).
 */
import { IDEMPOTENCY_KEY_RE } from './contracts/common';
import { isApiError } from './errors';

export function newIdempotencyKey(prefix = 'pc'): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const key = `${prefix}_${raw}`;
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new Error('Generated idempotency key is invalid');
  return key;
}

/** openapi-fetch `params` fragment: the generated types make this header required on money POSTs. */
export function idem(key: string) {
  return { header: { 'Idempotency-Key': key } };
}

export type RetryOptions = {
  /** Max additional attempts after the first. */
  retries?: number;
  /** First backoff in ms (doubles, capped at 4s). */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a money request that already carries an Idempotency-Key, retrying only the
 * failures that are safe to retry with the same key.
 */
export async function withIdempotentRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 5, baseDelayMs = 500, sleep = defaultSleep, onRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const retryable = isApiError(e) && e.retryable;
      if (!retryable || attempt >= retries) throw e;
      attempt += 1;
      onRetry?.(attempt, e);
      await sleep(Math.min(4000, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}
