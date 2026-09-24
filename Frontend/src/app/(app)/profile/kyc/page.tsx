'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { FileUp } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { InlineError, QueryState } from '@/components/states/states';
import { tierIndex } from '@/features/kyc/kyc-banner';
import { qk, useKyc, useQueryClient, useTiers } from '@/lib/api/hooks';
import { kyc as kycApi } from '@/lib/api/services';
import type { KycSubmission, TierLimit } from '@/lib/api/contracts/phase1';
import { kycSchema, type KycForm } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { cn } from '@/lib/utils';

const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const DOCS = ['CNIC', 'PASSPORT', 'EMIRATES_ID', 'DRIVING_LICENSE', 'BUSINESS_REGISTRATION'] as const;

export default function KycPage() {
  const t = useTranslations();
  const kyc = useKyc();
  const tiers = useTiers();
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <PageHeader
        title={t('kyc.title')}
        description={t('kyc.subtitle')}
        back={{ href: '/profile', label: t('nav.profile') }}
      />
      <QueryState query={tiers} skeleton={<Skeleton className="h-72 rounded-lg" />}>
        {(rows) => <TierComparison rows={rows} current={kyc.data?.tier ?? 'TIER_0'} />}
      </QueryState>
      <QueryState query={kyc} skeleton={<Skeleton className="h-96 rounded-lg" />}>
        {(k) => (
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            {k.tier !== 'TIER_3' && !k.submissions.some((s) => s.status === 'PENDING') ? (
              <UpgradeForm currentTier={k.tier} />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <IsoBlocks count={4} filled={tierIndex(k.tier) + 1} />
                  <p className="text-sm">{k.tier === 'TIER_3' ? t('home.kycMax') : t('home.kycPending')}</p>
                  <p className="text-xs text-fg-muted">{t('kyc.reviewTime')}</p>
                </CardContent>
              </Card>
            )}
            <Submissions submissions={k.submissions} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

function TierComparison({ rows, current }: { rows: TierLimit[]; current: string }) {
  const t = useTranslations();
  const currencies = ['PKR', 'AED', 'USD'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('kyc.compare')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">{t('kyc.compare')}</caption>
          <thead>
            <tr className="text-start text-xs text-fg-muted">
              <th scope="col" className="py-2 text-start font-medium">
                {t('common.currency')}
              </th>
              {TIERS.map((tier, i) => (
                <th
                  key={tier}
                  scope="col"
                  className={cn('px-3 py-2 text-start font-medium', tier === current && 'text-accent-text')}
                >
                  <span className="flex items-center gap-2">
                    <IsoBlocks count={4} filled={i + 1} className="h-8" />
                    <span>
                      {t(`kyc.tiers.${tier}`)}
                      {tier === current ? (
                        <span className="block text-[10px] tracking-wide uppercase">{t('kyc.currentTier')}</span>
                      ) : null}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c} className="border-t border-border/60 align-top">
                <th scope="row" className="py-3 text-start font-semibold">
                  {c}
                </th>
                {TIERS.map((tier) => {
                  const l = rows.find((r) => r.tier === tier && r.currency === c);
                  return (
                    <td key={tier} className={cn('px-3 py-3', tier === current && 'bg-accent-tint/60')}>
                      {!l || !l.permitted ? (
                        <span className="text-xs text-fg-muted">{t('kyc.notPermitted')}</span>
                      ) : (
                        <dl className="grid gap-0.5 text-xs">
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-muted">{t('kyc.daily')}</dt>
                            <dd>
                              <Amount money={l.daily} size="xs" trimZeroFraction />
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-muted">{t('kyc.monthly')}</dt>
                            <dd>
                              <Amount money={l.monthly} size="xs" trimZeroFraction />
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-muted">{t('kyc.maxBalance')}</dt>
                            <dd>
                              <Amount money={l.maxBalance} size="xs" trimZeroFraction />
                            </dd>
                          </div>
                        </dl>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function UpgradeForm({ currentTier }: { currentTier: string }) {
  const t = useTranslations();
  const fe = useFieldError();
  const qc = useQueryClient();
  const nextTiers = (['TIER_1', 'TIER_2', 'TIER_3'] as const).filter((x) => tierIndex(x) > tierIndex(currentTier));
  const [step, setStep] = React.useState(1);
  const [file, setFile] = React.useState<File | null>(null);
  const form = useForm<KycForm>({
    resolver: zodResolver(kycSchema),
    defaultValues: {
      targetTier: nextTiers[0] ?? 'TIER_1',
      documentType: 'CNIC',
      documentNumber: '',
      dateOfBirth: '',
      address: '',
      businessName: '',
    },
  });
  const docType = useWatch({ control: form.control, name: 'documentType' });
  const submit = useMutation({
    mutationFn: async (v: KycForm) => {
      let documentRef: string | undefined;
      if (file) {
        const up = await kycApi.createUpload({ contentType: file.type as 'image/jpeg', sizeBytes: file.size });
        if (up.uploadUrl.startsWith('https://')) {
          await fetch(up.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } });
        }
        documentRef = up.documentRef;
      }
      return kycApi.submit({
        targetTier: v.targetTier,
        documentType: v.documentType,
        documentNumber: v.documentNumber.trim(),
        dateOfBirth: v.dateOfBirth,
        address: v.address.trim(),
        businessName: v.businessName?.trim() || undefined,
        documentRef,
      });
    },
    onSuccess: () => {
      toast.success(t('kyc.submitted'));
      void qc.invalidateQueries({ queryKey: qk.kyc });
    },
  });
  const next = async () => {
    const ok = await form.trigger(
      step === 1 ? ['targetTier', 'documentType'] : ['documentNumber', 'dateOfBirth', 'address', 'businessName'],
    );
    if (ok) setStep((s) => s + 1);
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('kyc.startUpgrade')}</CardTitle>
          <p className="text-xs text-fg-muted">{t('kyc.step', { n: step, total: 3 })}</p>
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => submit.mutate(v))} noValidate>
          {step === 1 ? (
            <>
              <Field label={t('kyc.upgradeTo', { tier: '' }).trim()}>
                <Controller
                  control={form.control}
                  name="targetTier"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={nextTiers.map((x) => ({ value: x, label: t(`kyc.tiers.${x}`) }))}
                    />
                  )}
                />
              </Field>
              <Field label={t('kyc.documentType')}>
                <Controller
                  control={form.control}
                  name="documentType"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={DOCS.map((d) => ({ value: d, label: t(`kyc.documents.${d}`) }))}
                    />
                  )}
                />
              </Field>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Field label={t('kyc.documentNumber')} error={fe(form.formState.errors.documentNumber)}>
                <Input dir="ltr" autoComplete="off" {...form.register('documentNumber')} />
              </Field>
              <Field label={t('kyc.dateOfBirth')} error={fe(form.formState.errors.dateOfBirth)}>
                <Input type="date" autoComplete="bday" {...form.register('dateOfBirth')} />
              </Field>
              <Field label={t('kyc.address')} error={fe(form.formState.errors.address)}>
                <Textarea autoComplete="street-address" {...form.register('address')} />
              </Field>
              {docType === 'BUSINESS_REGISTRATION' ? (
                <Field label={t('kyc.businessName')} error={fe(form.formState.errors.businessName)}>
                  <Input autoComplete="organization" {...form.register('businessName')} />
                </Field>
              ) : null}
            </>
          ) : null}
          {step === 3 ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t('kyc.upload')}</span>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-6 text-center hover:border-accent/50">
                <FileUp className="size-6 text-accent" aria-hidden />
                <span className="text-sm">{file ? t('kyc.uploaded', { name: file.name }) : t('kyc.uploadAction')}</span>
                <span className="text-xs text-fg-muted">{t('kyc.uploadHint')}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f && f.size <= 5 * 1024 * 1024 ? f : null);
                  }}
                />
              </label>
            </div>
          ) : null}
          {submit.error ? <InlineError error={submit.error} /> : null}
          <div className="flex justify-between gap-2">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                {t('common.back')}
              </Button>
            ) : (
              <span />
            )}
            {step < 3 ? (
              <Button type="button" onClick={() => void next()}>
                {t('common.continue')}
              </Button>
            ) : (
              <Button type="submit" loading={submit.isPending}>
                {t('common.submit')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Submissions({ submissions }: { submissions: KycSubmission[] }) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('kyc.submissions')}</CardTitle>
      </CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('states.emptyTitle')}</p>
        ) : (
          <ul className="grid gap-3">
            {submissions.map((s) => (
              <li key={s.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t(`kyc.tiers.${s.targetTier as 'TIER_1'}`)}</span>
                  <Badge
                    tone={s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'danger' : 'warning'}
                    dot
                  >
                    {t(`kyc.status.${s.status as 'PENDING'}`)}
                  </Badge>
                </div>
                <p className="text-xs text-fg-muted">
                  {t(`kyc.documents.${s.documentType as 'CNIC'}`)} ·{' '}
                  {format.dateTime(new Date(s.createdAt), { dateStyle: 'medium' })}
                </p>
                {s.rejectionReason ? <p className="mt-1 text-xs text-danger">{s.rejectionReason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
