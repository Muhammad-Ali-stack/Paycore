'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { Segmented } from '@/components/ui/primitives';
import { InlineError } from '@/components/states/states';
import { registerSchema, type RegisterForm } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { auth } from '@/lib/api/services';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const fe = useFieldError();
  const router = useRouter();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', phone: '', password: '', confirmPassword: '', role: 'CONSUMER' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const phone = v.phone.replace(/[\s-]/g, '');
      const res = await auth.register({ phone, password: v.password, fullName: v.fullName.trim(), role: v.role });
      const qs = new URLSearchParams({ phone });
      // devOtp only exists outside production; shown as a hint on the verify page.
      if (res.devOtp) qs.set('dev', res.devOtp);
      router.push(`/verify?${qs.toString()}`);
    } catch (e) {
      setError(e);
    }
  });

  return (
    <div className="grid gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('registerTitle')}</h1>
        <p className="text-sm text-fg-muted">{t('registerSubtitle')}</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" id="acct-type">
            {t('accountType')}
          </span>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Segmented
                label={t('accountType')}
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'CONSUMER', label: t('personal') },
                  { value: 'MERCHANT', label: t('business') },
                ]}
              />
            )}
          />
        </div>
        <Field label={t('fullName')} error={fe(errors.fullName)}>
          <Input autoComplete="name" {...form.register('fullName')} />
        </Field>
        <Field label={t('phone')} hint={t('phoneHint')} error={fe(errors.phone)}>
          <Input type="tel" autoComplete="tel" dir="ltr" placeholder="+923001234567" {...form.register('phone')} />
        </Field>
        <Field label={t('password')} error={fe(errors.password)}>
          <PasswordInput
            autoComplete="new-password"
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            {...form.register('password')}
          />
        </Field>
        <Field label={t('confirmPassword')} error={fe(errors.confirmPassword)}>
          <PasswordInput
            autoComplete="new-password"
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            {...form.register('confirmPassword')}
          />
        </Field>
        {error ? <InlineError error={error} /> : null}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('createAccount')}
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-medium text-accent-text hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </div>
  );
}
