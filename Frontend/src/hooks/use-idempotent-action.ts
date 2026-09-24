'use client';

import { useCallback, useRef, useState } from 'react';
import { newIdempotencyKey, withIdempotentRetry, type RetryOptions } from '@/lib/api/idempotency';
import { isApiError } from '@/lib/api/errors';

export type ActionStatus = 'idle' | 'pending' | 'retrying' | 'success' | 'error';

/**
 * One Idempotency-Key per logical money action.
 *
 * - `begin()` mints the key; call it when the confirm sheet opens.
 * - `run(args)` sends with that key. Double clicks share the in-flight promise,
 *   and retryable failures (network, 5xx, 409 IDEMPOTENCY_IN_PROGRESS) are retried
 *   with the SAME key, so the backend replays rather than charging twice.
 * - PIN_INVALID / PIN_LOCKED: the backend rejects these before recording anything,
 *   so the same key is kept for the corrected PIN (contract [backend] note).
 * - Business failures (INSUFFICIENT_FUNDS, LIMIT_EXCEEDED, QR_ALREADY_PAID, ...) are
 *   FINAL per key on the backend (a retry replays the same error), so the key is
 *   rotated: the next attempt, usually with a changed amount or recipient, is new.
 */
export function useIdempotentAction<TArgs, TResult>(
  fn: (args: TArgs, idempotencyKey: string) => Promise<TResult>,
  options: Omit<RetryOptions, 'onRetry'> = {},
) {
  const keyRef = useRef<string | null>(null);
  const inflight = useRef<Promise<TResult> | null>(null);
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const [data, setData] = useState<TResult | null>(null);

  const begin = useCallback(() => {
    if (!inflight.current) {
      keyRef.current = newIdempotencyKey();
      setStatus('idle');
      setError(null);
      setData(null);
    }
    return keyRef.current!;
  }, []);

  const run = useCallback(
    (args: TArgs): Promise<TResult> => {
      if (inflight.current) return inflight.current;
      if (!keyRef.current) keyRef.current = newIdempotencyKey();
      const key = keyRef.current;
      setStatus('pending');
      setError(null);
      const p = withIdempotentRetry(() => fn(args, key), {
        ...options,
        onRetry: () => setStatus('retrying'),
      })
        .then((result) => {
          setData(result);
          setStatus('success');
          return result;
        })
        .catch((e: unknown) => {
          setError(e);
          setStatus('error');
          const keepKey = isApiError(e) && (e.retryable || e.isPinError);
          if (!keepKey) keyRef.current = newIdempotencyKey();
          throw e;
        })
        .finally(() => {
          inflight.current = null;
        });
      inflight.current = p;
      return p;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );

  const reset = useCallback(() => {
    if (inflight.current) return;
    keyRef.current = null;
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    begin,
    run,
    reset,
    status,
    error,
    data,
    pending: status === 'pending' || status === 'retrying',
    /** Exposed for tests and debugging only. */
    currentKey: () => keyRef.current,
  };
}
