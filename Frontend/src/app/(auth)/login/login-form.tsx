'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { InlineError } from '@/components/states/states';
import { loginSchema, type LoginForm as LoginValues } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { auth } from '@/lib/api/services';
import { isApiError } from '@/lib/api/errors';
import { getDeviceId, getDeviceName } from '@/lib/device';
import { roleHome } from '@/lib/bff/jwt';

const DEMO = [
  { key: 'demoConsumer', phone: '+923001234567' },
  { key: 'demoMerchant', phone: '+923009876543' },
  { key: 'demoAdmin', phone: '+923000000001' },
  { key: 'demoChecker', phone: '+923000000002' },
] as const;

export function LoginForm({ mocking }: { mocking: boolean }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { phone: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const session = await auth.login({
        phone: values.phone.replace(/[\s-]/g, ''),
        password: values.password,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
      });
      const next = params.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      router.replace(safeNext ?? roleHome(session.role));
      router.refresh();
    } catch (e) {
      if (isApiError(e) && e.code === 'PHONE_NOT_VERIFIED') {
        router.push(`/verify?phone=${encodeURIComponent(values.phone)}`);
        return;
      }
      setError(e);
    }
  });

  return (
    <div className="grid gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('loginTitle')}</h1>
        <p className="text-sm text-fg-muted">{t('loginSubtitle')}</p>
      </div>
      {params.get('expired') ? (
        <p role="status" className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning">
          {t('sessionExpired')}
        </p>
      ) : null}
      {params.get('verified') ? (
        <p role="status" className="rounded-md border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">
          {t('verified')}
        </p>
      ) : null}
      {params.get('reset') ? (
        <p role="status" className="rounded-md border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">
          {t('resetDone')}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label={t('phone')} hint={t('phoneHint')} error={fe(errors.phone)}>
          <Input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            dir="ltr"
            placeholder="+923001234567"
            {...form.register('phone')}
          />
        </Field>
        <Field label={t('password')} error={fe(errors.password)}>
          <PasswordInput
            autoComplete="current-password"
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            {...form.register('password')}
          />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-accent-text hover:underline">
            {t('forgot')}
          </Link>
        </div>
        {error ? <InlineError error={error} /> : null}
        <Button type="submit" size="lg" block loading={isSubmitting} data-testid="login-submit">
          {t('signIn')}
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        {t('noAccount')}{' '}
        <Link href="/register" className="font-medium text-accent-text hover:underline">
          {t('createAccount')}
        </Link>
      </p>

      {mocking ? (
        <section aria-labelledby="demo-accounts" className="rounded-lg border border-dashed border-border-strong p-4">
          <h2 id="demo-accounts" className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-accent" aria-hidden />
            {t('demoAccounts')}
          </h2>
          <p className="mb-3 text-xs text-fg-muted">
            {t('demoHint', { password: 'Password123!', pin: '1234', otp: '123456' })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <Button
                key={d.key}
                type="button"
                variant="secondary"
                size="sm"
                data-testid={`demo-${d.key}`}
                onClick={() => {
                  form.setValue('phone', d.phone, { shouldValidate: true });
                  form.setValue('password', 'Password123!', { shouldValidate: true });
                }}
              >
                {t(d.key)}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-muted">{tc('demo')}</p>
        </section>
      ) : null}
    </div>
  );
}
