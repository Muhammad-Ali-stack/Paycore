'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, Printer, RefreshCw, TimerOff } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, InlineError } from '@/components/states/states';
import { useCountdown } from '@/hooks/use-countdown';
import { useOutlets } from '@/lib/api/hooks';
import { merchant as merchantApi } from '@/lib/api/services';
import type { DynamicQr, Merchant, Outlet } from '@/lib/api/contracts/phase2';
import { formatMoney, parseAmountInput } from '@/lib/money';
import { QrCode } from '@/features/qr/qr-code';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { formatClock, useDynamicQrStatus } from '@/features/merchant/hooks';

const EXPIRY_OPTIONS = [30, 60, 300, 900, 3600] as const;

export default function MerchantQrPage() {
  const t = useTranslations('merchant');
  return (
    <MerchantGate banner>
      {(m) => (
        <>
          <PageHeader title={t('qrTitle')} description={t('qrDescription')} />
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <DynamicQrCard merchant={m} />
            <StaticQrSection />
          </div>
        </>
      )}
    </MerchantGate>
  );
}

/* ------------------------------- Static ---------------------------------- */

function StaticQrSection() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const outlets = useOutlets();
  return (
    <section aria-labelledby="static-qr-h" className="grid content-start gap-4">
      <div>
        <h2 id="static-qr-h" className="text-lg font-semibold tracking-tight">
          {t('staticQr')}
        </h2>
        <p className="text-sm text-fg-muted">{t('staticQrBody')}</p>
      </div>
      {outlets.isPending ? (
        <SkeletonGroup label={tc('loading')}>
          <Skeleton className="h-72 rounded-lg" />
        </SkeletonGroup>
      ) : outlets.isError ? (
        <ErrorState error={outlets.error} onRetry={() => void outlets.refetch()} />
      ) : outlets.data.length === 0 ? (
        <Card>
          <EmptyState title={t('noOutlets')} body={t('noOutletsBody')} />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {outlets.data.map((o) => (
            <li key={o.id}>
              <StaticQrCard outlet={o} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StaticQrCard({ outlet }: { outlet: Outlet }) {
  const t = useTranslations('merchant');
  return (
    <Card className="flex flex-col items-center gap-4 p-5 text-center">
      <div>
        <h3 className="text-sm font-semibold">{outlet.name}</h3>
        {outlet.address ? <p className="text-xs text-fg-muted">{outlet.address}</p> : null}
      </div>
      <QrCode payload={outlet.staticQr.payload} size={200} label={t('staticQrLabel', { name: outlet.name })} />
      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <CopyButton value={outlet.staticQr.payload} label={t('payload')} />
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          <Printer aria-hidden />
          {t('printQr')}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------- Dynamic --------------------------------- */

function DynamicQrCard({ merchant }: { merchant: Merchant }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const outlets = useOutlets();
  const currency = merchant.settlementCurrency;
  const [amount, setAmount] = React.useState('');
  const [amountError, setAmountError] = React.useState<string | null>(null);
  const [pickedOutlet, setOutletId] = React.useState<string>('');
  const [expiry, setExpiry] = React.useState<string>('300');
  const [reference, setReference] = React.useState('');
  const [qr, setQr] = React.useState<DynamicQr | null>(null);

  const outletId = pickedOutlet || outlets.data?.[0]?.id || '';

  const create = useMutation({
    mutationFn: merchantApi.createDynamicQr,
    onSuccess: (d) => setQr(d),
  });

  const active = merchant.status === 'ACTIVE';

  const generate = (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseAmountInput(amount, currency);
    if (!r.ok) {
      setAmountError(
        r.reason === 'EMPTY' ? tv('required') : r.reason === 'TOO_MANY_DECIMALS' ? tv('amountDecimals') : tv('amount'),
      );
      return;
    }
    if (r.minor <= 0n) {
      setAmountError(tv('amountPositive'));
      return;
    }
    setAmountError(null);
    create.mutate({
      amount: r.normalized,
      currency,
      outletId: outletId || undefined,
      reference: reference.trim() || undefined,
      expiresInSeconds: Number(expiry),
    });
  };

  const reset = () => {
    setQr(null);
    setAmount('');
    setReference('');
    create.reset();
  };

  const expiryOptions = EXPIRY_OPTIONS.map((s) => ({
    value: String(s),
    label: s < 60 ? t('seconds', { count: s }) : t('minutes', { count: s / 60 }),
  }));

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-1">
        <CardTitle as="h2" className="text-lg">
          {t('dynamicQr')}
        </CardTitle>
        <CardDescription>{t('dynamicQrBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        {qr ? (
          <DynamicQrResult qr={qr} onNew={reset} />
        ) : (
          <form onSubmit={generate} noValidate className="grid gap-4">
            {!active ? (
              <p
                role="status"
                className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning"
              >
                {t('notActive')}
              </p>
            ) : null}
            <Field label={t('amountFor')} error={amountError}>
              <AmountInput
                value={amount}
                onValueChange={(v) => {
                  setAmount(v);
                  if (amountError) setAmountError(null);
                }}
                currency={currency}
                data-testid="dynamic-qr-amount"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('outlet')}>
                <Select
                  value={outletId || undefined}
                  onValueChange={setOutletId}
                  placeholder={outlets.isPending ? tc('loading') : t('defaultOutlet')}
                  disabled={!outlets.data?.length}
                  options={(outlets.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
                />
              </Field>
              <Field label={t('expiresIn')}>
                <Select value={expiry} onValueChange={setExpiry} options={expiryOptions} />
              </Field>
            </div>
            <Field label={tc('reference')} optional={tc('optional')}>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={60}
                placeholder={t('referencePlaceholder')}
              />
            </Field>
            {create.error ? <InlineError error={create.error} /> : null}
            <Button
              type="submit"
              size="lg"
              block
              loading={create.isPending}
              disabled={!active}
              data-testid="dynamic-qr-generate"
            >
              {t('generate')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DynamicQrResult({ qr, onNew }: { qr: DynamicQr; onNew: () => void }) {
  const t = useTranslations('merchant');
  const locale = useLocale() === 'ur' ? 'ur' : 'en';
  const poll = useDynamicQrStatus(qr.qrId);
  const status = poll.data?.status ?? qr.status;
  const left = useCountdown(qr.expiresAt);
  const amountText = formatMoney(qr.amount, { locale });

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Amount money={qr.amount} size="xl" />
      <div className="relative">
        <QrCode
          payload={qr.payload}
          size={260}
          label={t('dynamicQrLabel', { amount: amountText })}
          className={status === 'ACTIVE' ? undefined : 'opacity-25'}
        />
        {status === 'PAID' ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <CheckCircle2 className="size-20 text-success" aria-hidden />
          </span>
        ) : status === 'EXPIRED' ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <TimerOff className="size-16 text-fg-muted" aria-hidden />
          </span>
        ) : null}
      </div>

      <div role="status" aria-live="polite" className="grid justify-items-center gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span data-testid="dynamic-qr-status" className="code text-xs text-fg-muted">
            {status}
          </span>
        </div>
        {status === 'ACTIVE' ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Clock className="size-4" aria-hidden />
            <span>{t('waiting')}</span>
            <span className="money" aria-label={t('timeLeft', { time: formatClock(left) })}>
              {formatClock(left)}
            </span>
          </p>
        ) : status === 'PAID' ? (
          <p className="text-sm text-success">{t('paidBody')}</p>
        ) : (
          <p className="text-sm text-fg-muted">{t('expiredBody')}</p>
        )}
      </div>

      <div className="grid w-full gap-1.5 text-start">
        <span className="text-xs text-fg-muted">{t('payload')}</span>
        <div className="flex items-center gap-2 rounded-md border border-border bg-raised p-2">
          <code dir="ltr" data-testid="dynamic-qr-payload" className="code min-w-0 flex-1 text-xs break-all text-fg">
            {qr.payload}
          </code>
          <CopyButton value={qr.payload} />
        </div>
      </div>
      {poll.isError ? <InlineError error={poll.error} className="w-full" /> : null}
      <Button variant={status === 'ACTIVE' ? 'secondary' : 'primary'} onClick={onNew} block>
        <RefreshCw aria-hidden />
        {t('newCode')}
      </Button>
    </div>
  );
}
