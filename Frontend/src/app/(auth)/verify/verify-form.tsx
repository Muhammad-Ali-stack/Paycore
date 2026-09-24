'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { InlineError } from '@/components/states/states';
import { auth } from '@/lib/api/services';

const RESEND_SECONDS = 30;

export function VerifyForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get('phone') ?? '';
  const [devOtp, setDevOtp] = React.useState(params.get('dev'));
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);
  const [pending, setPending] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(RESEND_SECONDS);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const submit = async (value = code) => {
    if (value.length !== 6 || pending) return;
    setPending(true);
    setError(null);
    try {
      await auth.verifyPhone({ phone, code: value });
      router.replace('/login?verified=1');
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const r = await auth.resendOtp({ phone });
      if (r.devOtp) setDevOtp(r.devOtp);
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('verifyTitle')}</h1>
        <p className="text-sm text-fg-muted">
          {t.rich('verifySubtitle', { phone: () => <bdi className="code">{phone}</bdi> })}
        </p>
      </div>
      <CodeInput
        length={6}
        value={code}
        onChange={setCode}
        onComplete={(v) => void submit(v)}
        autoFocus
        aria-label={t('code')}
        disabled={pending}
      />
      {devOtp ? <p className="text-xs text-fg-muted">{t('devOtp', { code: devOtp })}</p> : null}
      {error ? <InlineError error={error} /> : null}
      <Button type="submit" size="lg" block loading={pending} disabled={code.length !== 6}>
        {t('verify')}
      </Button>
      <Button type="button" variant="link" disabled={cooldown > 0} onClick={() => void resend()}>
        {cooldown > 0 ? t('resendIn', { s: cooldown }) : t('resend')}
      </Button>
    </form>
  );
}
