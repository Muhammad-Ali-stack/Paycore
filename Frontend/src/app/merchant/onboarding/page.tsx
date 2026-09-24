'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { ErrorState, InlineError } from '@/components/states/states';
import { merchantOnboardingSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { useMerchant, useQueryClient } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import { CURRENCIES } from '@/lib/api/contracts/common';
import { isNotFound } from '@/features/merchant/hooks';

type FormIn = z.input<typeof merchantOnboardingSchema>;
type FormOut = z.output<typeof merchantOnboardingSchema>;

export default function MerchantOnboardingPage() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const existing = useMerchant();

  if (existing.isPending) {
    return (
      <SkeletonGroup label={tc('loading')} className="grid max-w-2xl gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 rounded-lg" />
      </SkeletonGroup>
    );
  }
  if (existing.isError && !isNotFound(existing.error)) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }
  if (existing.data) {
    return (
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">{t('alreadyRegistered')}</h1>
        <Button asChild>
          <Link href="/merchant">{t('goToDashboard')}</Link>
        </Button>
      </Card>
    );
  }
  return <OnboardingForm />;
}

function OnboardingForm() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(merchantOnboardingSchema),
    defaultValues: {
      businessName: '',
      category: '',
      registrationNumber: '',
      settlementCurrency: 'PKR',
      iban: '',
      accountTitle: '',
      bankName: '',
      website: '',
    },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await merchant.register({
        businessName: v.businessName,
        category: v.category,
        registrationNumber: v.registrationNumber,
        settlementCurrency: v.settlementCurrency,
        settlementBank: { iban: v.iban, accountTitle: v.accountTitle, bankName: v.bankName },
        website: v.website ? v.website : undefined,
      });
      toast.success(t('registered'));
      await qc.invalidateQueries({ queryKey: ['merchant'] });
      router.push('/merchant');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title={t('onboardingTitle')} description={t('onboardingBody')} />
      <form onSubmit={submit} noValidate className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('onboardingBusiness')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('businessName')} error={fe(errors.businessName)} className="sm:col-span-2">
              <Input autoComplete="organization" {...form.register('businessName')} />
            </Field>
            <Field label={t('category')} hint={t('categoryHint')} error={fe(errors.category)}>
              <Input inputMode="numeric" maxLength={4} dir="ltr" placeholder="5814" {...form.register('category')} />
            </Field>
            <Field label={t('registrationNumber')} error={fe(errors.registrationNumber)}>
              <Input dir="ltr" {...form.register('registrationNumber')} />
            </Field>
            <Field label={t('settlementCurrency')} error={fe(errors.settlementCurrency)}>
              <Controller
                control={form.control}
                name="settlementCurrency"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  />
                )}
              />
            </Field>
            <Field label={t('website')} optional={tc('optional')} error={fe(errors.website)}>
              <Input type="url" dir="ltr" placeholder="https://" {...form.register('website')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('onboardingBank')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('iban')} error={fe(errors.iban)} className="sm:col-span-2">
              <Input dir="ltr" autoComplete="off" placeholder="PK36SCBL0000001123456702" {...form.register('iban')} />
            </Field>
            <Field label={t('accountTitle')} error={fe(errors.accountTitle)}>
              <Input {...form.register('accountTitle')} />
            </Field>
            <Field label={t('bankName')} error={fe(errors.bankName)}>
              <Input {...form.register('bankName')} />
            </Field>
          </CardContent>
        </Card>

        {error ? <InlineError error={error} /> : null}
        <div className="flex justify-end">
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            {t('register')}
          </Button>
        </div>
      </form>
    </div>
  );
}
