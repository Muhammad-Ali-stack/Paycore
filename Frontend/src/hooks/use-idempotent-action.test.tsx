import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIdempotentAction } from './use-idempotent-action';
import { ApiError } from '@/lib/api/errors';
import { IDEMPOTENCY_KEY_RE } from '@/lib/api/contracts/common';
import { newIdempotencyKey, withIdempotentRetry } from '@/lib/api/idempotency';

const inProgress = () => new ApiError({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS', message: 'busy' });
const pinInvalid = () =>
  new ApiError({ status: 422, code: 'PIN_INVALID', message: 'bad', details: { attemptsRemaining: 2 } });
const noSleep = { baseDelayMs: 0, sleep: () => Promise.resolve() };

describe('newIdempotencyKey', () => {
  it('matches the contract format and is unique', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(IDEMPOTENCY_KEY_RE);
    expect(a).not.toBe(b);
  });
});

describe('withIdempotentRetry', () => {
  it('retries 409 IDEMPOTENCY_IN_PROGRESS and network errors, then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(inProgress())
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce('ok');
    await expect(withIdempotentRetry(fn, noSleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does not retry definitive business errors', async () => {
    const fn = vi.fn().mockRejectedValue(pinInvalid());
    await expect(withIdempotentRetry(fn, noSleep)).rejects.toMatchObject({ code: 'PIN_INVALID' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('gives up after the retry budget', async () => {
    const fn = vi.fn().mockRejectedValue(inProgress());
    await expect(withIdempotentRetry(fn, { ...noSleep, retries: 2 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('useIdempotentAction', () => {
  it('uses one key for a logical action, including retries after 409', async () => {
    const keys: string[] = [];
    const fn = vi.fn(async (_: string, key: string) => {
      keys.push(key);
      if (keys.length === 1) throw inProgress();
      return 'paid';
    });
    const { result } = renderHook(() => useIdempotentAction(fn, noSleep));
    let key = '';
    act(() => {
      key = result.current.begin();
    });
    await act(async () => {
      await expect(result.current.run('1234')).resolves.toBe('paid');
    });
    expect(keys).toEqual([key, key]);
    expect(result.current.status).toBe('success');
  });

  it('shares the in-flight request on double click (one network call)', async () => {
    let resolve!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const { result } = renderHook(() => useIdempotentAction(fn, noSleep));
    act(() => void result.current.begin());
    let p1!: Promise<string>;
    let p2!: Promise<string>;
    act(() => {
      p1 = result.current.run(undefined as never);
      p2 = result.current.run(undefined as never);
    });
    expect(p1).toBe(p2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await act(async () => {
      resolve('done');
      await p1;
    });
    expect(result.current.pending).toBe(false);
  });

  it('keeps the key after PIN_INVALID (nothing was recorded server-side)', async () => {
    const keys: string[] = [];
    const fn = vi.fn(async (pin: string, key: string) => {
      keys.push(key);
      if (pin === '0000') throw pinInvalid();
      return 'ok';
    });
    const { result } = renderHook(() => useIdempotentAction(fn, noSleep));
    act(() => void result.current.begin());
    await act(async () => {
      await result.current.run('0000').catch(() => undefined);
    });
    expect(result.current.status).toBe('error');
    await act(async () => {
      await result.current.run('4829');
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('rotates the key after a business failure, which is final per key on the backend', async () => {
    const keys: string[] = [];
    let funds = false;
    const fn = vi.fn(async (_: void, key: string) => {
      keys.push(key);
      if (!funds) throw new ApiError({ status: 422, code: 'INSUFFICIENT_FUNDS', message: 'x' });
      return 'ok';
    });
    const { result } = renderHook(() => useIdempotentAction(fn, noSleep));
    act(() => void result.current.begin());
    await act(async () => {
      await result.current.run().catch(() => undefined);
    });
    funds = true; // e.g. the user topped up or lowered the amount
    await act(async () => {
      await result.current.run();
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps the key after success (accidental resubmits replay safely) until begin/reset', async () => {
    const keys: string[] = [];
    const fn = vi.fn(async (_: void, key: string) => {
      keys.push(key);
      return 'ok';
    });
    const { result } = renderHook(() => useIdempotentAction(fn, noSleep));
    act(() => void result.current.begin());
    await act(async () => void (await result.current.run()));
    await act(async () => void (await result.current.run()));
    expect(keys[0]).toBe(keys[1]);
    act(() => void result.current.begin());
    await act(async () => void (await result.current.run()));
    expect(keys[2]).not.toBe(keys[0]);
  });
});
