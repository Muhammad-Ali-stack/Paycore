'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { InlineError } from '@/components/states/states';
import { phoneSchema, resetSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { auth } from '@/lib/api/services';

const phoneForm = z.object({ phone: phoneSchema });

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const fe = useFieldError();
  const router = useRouter();
  const [phone, setPhone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const step1 = useForm<z.input<typeof phoneForm>>({ resolver: zodResolver(phoneForm), defaultValues: { phone: '' } });
  const step2 = useForm<z.input<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', newPassword: '', confirmPassword: '' },
  });

  const sendCode = step1.handleSubmit(async (v) => {
    setError(null);
    const p = v.phone.replace(/[\s-]/g, '');
    try {
      await auth.forgot({ phone: p });
      setPhone(p);
    } catch (e) {
      setError(e);
    }
  });

  const reset = step2.handleSubmit(async (v) => {
    setError(null);
    try {
      await auth.reset({ phone: phone!, code: v.code, newPassword: v.newPassword });
      router.replace('/login?reset=1');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <div className="grid gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('forgotTitle')}</h1>
        <p className="text-sm text-fg-muted">{t('forgotSubtitle')}</p>
      </div>
      {!phone ? (
        <form onSubmit={sendCode} className="grid gap-4" noValidate>
          <Field label={t('phone')} hint={t('phoneHint')} error={fe(step1.formState.errors.phone)}>
            <Input type="tel" autoComplete="tel" dir="ltr" placeholder="+923001234567" {...step1.register('phone')} />
          </Field>
          {error ? <InlineError error={error} /> : null}
          <Button type="submit" size="lg" block loading={step1.formState.isSubmitting}>
            {t('sendCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={reset} className="grid gap-4" noValidate>
          <p role="status" className="text-sm text-success">
            {t('codeSent')}
          </p>
          <Field label={t('code')} error={fe(step2.formState.errors.code)}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              {...step2.register('code')}
            />
          </Field>
          <Field label={t('newPassword')} error={fe(step2.formState.errors.newPassword)}>
            <PasswordInput
              autoComplete="new-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              {...step2.register('newPassword')}
            />
          </Field>
          <Field label={t('confirmPassword')} error={fe(step2.formState.errors.confirmPassword)}>
            <PasswordInput
              autoComplete="new-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              {...step2.register('confirmPassword')}
            />
          </Field>
          {error ? <InlineError error={error} /> : null}
          <Button type="submit" size="lg" block loading={step2.formState.isSubmitting}>
            {t('resetPassword')}
          </Button>
        </form>
      )}
      <Link href="/login" className="text-center text-sm text-accent-text hover:underline">
        {t('signIn')}
      </Link>
    </div>
  );
}
