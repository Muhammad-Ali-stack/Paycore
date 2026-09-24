'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { InlineError } from '@/components/states/states';
import { auth } from '@/lib/api/services';
import { isApiError } from '@/lib/api/errors';
import { useUiStore } from '@/stores/ui';

export const AUTO_LOCK_MINUTES = Number(process.env.NEXT_PUBLIC_AUTOLOCK_MINUTES ?? 5);
/** Hard sign-out after this long locked. */
const LOCKED_SIGNOUT_MINUTES = 30;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Locks the UI after inactivity (and when returning to a tab that was hidden
 * too long). Unlock needs the payment PIN, verified by the backend. Content is
 * hidden from view and from assistive tech while locked.
 */
export function AutoLock() {
  const locked = useUiStore((s) => s.locked);
  const lock = useUiStore((s) => s.lock);
  const unlock = useUiStore((s) => s.unlock);
  const last = React.useRef(0);
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const [pin, setPin] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const signOut = React.useCallback(async () => {
    await auth.logout().catch(() => undefined);
    qc.clear();
    unlock();
    router.replace('/login');
  }, [qc, router, unlock]);

  React.useEffect(() => {
    if (AUTO_LOCK_MINUTES <= 0) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
    };
    EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      const idle = Date.now() - last.current;
      if (!useUiStore.getState().locked && idle > AUTO_LOCK_MINUTES * 60_000) lock();
      if (useUiStore.getState().locked && idle > LOCKED_SIGNOUT_MINUTES * 60_000) void signOut();
    }, 5_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [lock, signOut]);

  React.useEffect(() => {
    const root = document.getElementById('app-frame');
    if (!root) return;
    if (locked) root.setAttribute('inert', '');
    else root.removeAttribute('inert');
  }, [locked]);

  if (!locked) return null;

  const submit = async (value: string) => {
    if (value.length < 4 || pending) return;
    setPending(true);
    setError(null);
    try {
      await auth.verifyPin(value);
      setPin('');
      last.current = Date.now();
      unlock();
    } catch (e) {
      setError(e);
      setPin('');
      if (isApiError(e) && e.code === 'UNAUTHORIZED') void signOut();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/95 p-6 backdrop-blur-xl"
    >
      <form
        className="grid w-full max-w-sm justify-items-center gap-5 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(pin);
        }}
      >
        <LogoMark className="size-14" />
        <div className="space-y-1">
          <h2 id="lock-title" className="text-xl font-semibold">
            {t('lock.title')}
          </h2>
          <p className="text-sm text-fg-muted">{t('lock.subtitle')}</p>
        </div>
        <CodeInput
          length={6}
          minLength={4}
          mask
          value={pin}
          onChange={setPin}
          autoFocus
          aria-label={t('pin.label')}
          disabled={pending}
        />
        {error ? <InlineError error={error} className="w-full" /> : null}
        <Button type="submit" block size="lg" loading={pending} disabled={pin.length < 4}>
          {t('lock.unlock')}
        </Button>
        <Button type="button" variant="link" onClick={() => void signOut()}>
          {t('lock.useDifferent')}
        </Button>
      </form>
    </div>
  );
}
