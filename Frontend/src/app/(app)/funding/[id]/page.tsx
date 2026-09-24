'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, FlaskConical, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { InlineError, QueryState } from '@/components/states/states';
import { invalidateMoney, qk, useFunding, useQueryClient } from '@/lib/api/hooks';
import { funding } from '@/lib/api/services';
import type { FundingStatus } from '@/lib/api/contracts/phase2';
import { formatMoney } from '@/lib/money';
import { cn, shortId } from '@/lib/utils';

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';

export default function FundingStatusPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const format = useFormatter();
  const qc = useQueryClient();
  const q = useFunding(id);
  const prevStatus = React.useRef<FundingStatus | null>(null);

  // Balances change only when the bank answers: refresh them on the transition.
  React.useEffect(() => {
    const s = q.data?.status;
    if (s && prevStatus.current === 'PENDING' && s !== 'PENDING') void invalidateMoney(qc);
    if (s) prevStatus.current = s;
  }, [q.data?.status, qc]);

  const simulate = useMutation({
    mutationFn: (outcome: 'SUCCEEDED' | 'FAILED') => funding.simulate({ fundingId: id, outcome }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.funding(id) }),
  });

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader title={t('funding.statusTitle')} back={{ href: '/topup', label: t('funding.topupTitle') }} />
      <QueryState query={q} skeleton={<Skeleton className="h-96 rounded-lg" />}>
        {(f) => {
          const isTopup = f.direction === 'TOPUP';
          const Icon = f.status === 'SUCCEEDED' ? CheckCircle2 : f.status === 'PENDING' ? Clock : XCircle;
          return (
            <>
              <Card>
                <div className="balance-surface flex flex-col items-center gap-3 rounded-t-lg border-b border-border px-6 py-8 text-center">
                  <Icon
                    aria-hidden
                    className={cn(
                      'size-12',
                      f.status === 'SUCCEEDED'
                        ? 'text-success'
                        : f.status === 'PENDING'
                          ? 'animate-pulse text-warning'
                          : 'text-danger',
                    )}
                  />
                  <p className="text-sm text-fg-muted">
                    {isTopup ? t('funding.topupTitle') : t('funding.withdrawTitle')}
                  </p>
                  <Amount money={f.amount} size="xl" />
                  <div role="status" aria-live="polite" className="flex items-center gap-2">
                    <StatusBadge status={f.status} />
                    <span className="sr-only" data-testid="funding-status">
                      {f.status}
                    </span>
                  </div>
                  <p className="max-w-sm text-sm text-fg-muted">
                    {f.status === 'PENDING'
                      ? t('funding.pendingBody')
                      : f.status === 'SUCCEEDED'
                        ? isTopup
                          ? t('funding.succeededTopup', { amount: formatMoney(f.amount) })
                          : t('funding.succeededWithdraw', { amount: formatMoney(f.amount) })
                        : isTopup
                          ? t('funding.failedBody')
                          : t('funding.failedWithdrawBody')}
                  </p>
                  {f.failureReason ? <p className="text-xs text-danger">{f.failureReason}</p> : null}
                </div>
                <CardContent className="grid gap-6 pt-5">
                  <Stepper status={f.status} />
                  <DetailList>
                    <DetailRow label={t('common.fee')}>
                      {f.fee.amountMinor === '0' ? t('common.free') : <Amount money={f.fee} />}
                    </DetailRow>
                    <DetailRow label={t('funding.method')}>
                      {f.method === 'CARD' ? t('funding.card') : t('funding.bankTransfer')}
                    </DetailRow>
                    {f.bankReference ? (
                      <DetailRow label={t('funding.bankRef')}>
                        <span className="code text-xs">{f.bankReference}</span>
                      </DetailRow>
                    ) : null}
                    <DetailRow label={t('common.id')}>
                      <span className="code text-xs">{shortId(f.id)}</span>
                    </DetailRow>
                    <DetailRow label={t('common.createdAt')}>
                      {format.dateTime(new Date(f.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}
                    </DetailRow>
                  </DetailList>
                  {!isTopup && f.status === 'PENDING' ? (
                    <p className="text-xs text-fg-muted">{t('funding.heldNote')}</p>
                  ) : null}
                </CardContent>
              </Card>

              {f.instructions && f.status === 'PENDING' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('funding.instructions')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <p className="text-sm text-fg-muted">
                      {t('funding.instructionsBody', { amount: formatMoney(f.amount) })}
                    </p>
                    <DetailList>
                      <DetailRow label={t('funding.bankName')}>{f.instructions.bankName}</DetailRow>
                      <DetailRow label={t('funding.accountTitle')}>{f.instructions.accountTitle}</DetailRow>
                      <DetailRow label={t('funding.iban')}>
                        <span className="code text-xs">{f.instructions.iban}</span>
                      </DetailRow>
                      <DetailRow label={t('common.reference')}>
                        <span className="code text-xs">{f.instructions.reference}</span>
                      </DetailRow>
                    </DetailList>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton value={f.instructions.iban} label={t('funding.iban')} />
                      <CopyButton value={f.instructions.reference} label={t('common.reference')} />
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>{t('funding.timeline')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="grid gap-3 border-s border-border ps-4">
                    {f.timeline.map((e, i) => (
                      <li key={i} className="relative">
                        <span
                          aria-hidden
                          className="absolute -start-[21px] top-1 size-2.5 rounded-full border-2 border-bg bg-accent"
                        />
                        <StatusBadge status={e.status} />
                        <span className="ms-2 text-xs text-fg-muted">
                          {format.dateTime(new Date(e.at), { timeStyle: 'medium' })}
                        </span>
                        {e.reason ? <p className="mt-1 text-xs text-fg-muted">{e.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>

              {MOCKING && f.status === 'PENDING' ? (
                <Card className="border-dashed">
                  <CardContent className="grid gap-3 pt-5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <FlaskConical className="size-4 text-accent" aria-hidden /> {t('funding.simulate')}
                    </p>
                    <p className="text-xs text-fg-muted">{t('funding.simulateHint')}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={simulate.isPending && simulate.variables === 'SUCCEEDED'}
                        onClick={() => simulate.mutate('SUCCEEDED')}
                      >
                        {t('funding.simulateSuccess')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={simulate.isPending && simulate.variables === 'FAILED'}
                        onClick={() => simulate.mutate('FAILED')}
                      >
                        {t('funding.simulateFail')}
                      </Button>
                    </div>
                    {simulate.error ? <InlineError error={simulate.error} /> : null}
                  </CardContent>
                </Card>
              ) : null}

              {f.status !== 'PENDING' ? (
                <div className="flex justify-end gap-2">
                  <Button asChild variant="secondary">
                    <Link href={isTopup ? '/topup' : '/withdraw'}>
                      {isTopup ? t('funding.topupTitle') : t('funding.withdrawTitle')}
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link href="/home">{t('common.done')}</Link>
                  </Button>
                </div>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function Stepper({ status }: { status: FundingStatus }) {
  const t = useTranslations('funding');
  const done = status !== 'PENDING';
  const steps = [
    { key: 'PENDING', label: t('PENDING'), state: 'done' as const },
    {
      key: 'RESULT',
      label: status === 'PENDING' ? t('SUCCEEDED') : t(status),
      state: done ? (status === 'SUCCEEDED' ? ('done' as const) : ('failed' as const)) : ('todo' as const),
    },
  ];
  return (
    <ol className="flex items-center gap-3" aria-label={t('statusTitle')}>
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-3">
          <span
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              s.state === 'done' && 'border-success/40 bg-success-tint text-success',
              s.state === 'failed' && 'border-danger/40 bg-danger-tint text-danger-text',
              s.state === 'todo' && 'border-border text-fg-muted',
            )}
          >
            {i + 1}
          </span>
          <span className="text-sm">{s.label}</span>
          {i === 0 ? <span aria-hidden className={cn('h-px flex-1', done ? 'bg-success/50' : 'bg-border')} /> : null}
        </li>
      ))}
    </ol>
  );
}
