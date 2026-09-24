'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Amount } from '@/components/money/amount';
import { PageHeader } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListSkeleton, Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states/states';
import { useMerchantDashboard, useMerchantPayments } from '@/lib/api/hooks';
import type { Merchant, MerchantPayment } from '@/lib/api/contracts/phase2';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { VolumeChart } from '@/features/merchant/volume-chart';
import { PaymentsTable } from '@/features/merchant/payment-list';
import { PaymentDrawer } from '@/features/merchant/payment-drawer';
import { useDates } from '@/features/merchant/hooks';

export default function MerchantDashboardPage() {
  return <MerchantGate banner>{(m) => <Dashboard merchant={m} />}</MerchantGate>;
}

function Kpi({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-fg-muted">{label}</p>
      <div className="mt-2">{children}</div>
      {sub ? <p className="mt-1 text-xs text-fg-muted">{sub}</p> : null}
    </Card>
  );
}

function Dashboard({ merchant }: { merchant: Merchant }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const dash = useMerchantDashboard(merchant.settlementCurrency);
  const payments = useMerchantPayments({});
  const [open, setOpen] = React.useState<MerchantPayment | null>(null);
  const recent = payments.data?.pages[0]?.items.slice(0, 5) ?? [];

  return (
    <>
      <PageHeader title={merchant.businessName} description={t('dashboardDescription')} />

      <section aria-label={t('title')}>
        {dash.isPending ? (
          <SkeletonGroup label={tc('loading')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </SkeletonGroup>
        ) : dash.isError ? (
          <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="merchant-kpis">
            <Kpi label={t('todayVolume')} sub={t('todayCount', { count: dash.data.today.count })}>
              <Amount money={dash.data.today.volume} size="lg" className="text-accent-text" />
            </Kpi>
            <Kpi label={t('refundsToday')}>
              <Amount money={dash.data.today.refunds} size="lg" />
            </Kpi>
            <Kpi label={t('pendingSettlement')}>
              <Amount money={dash.data.pendingSettlement} size="lg" />
            </Kpi>
            <Kpi
              label={t('lastSettlement')}
              sub={
                dash.data.lastSettlement?.paidAt
                  ? t('paidOn', { date: dates.date(dash.data.lastSettlement.paidAt) })
                  : undefined
              }
            >
              {dash.data.lastSettlement ? (
                <Amount money={dash.data.lastSettlement.net} size="lg" />
              ) : (
                <p className="text-sm text-fg-muted">{t('noSettlementYet')}</p>
              )}
            </Kpi>
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('volume14')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dash.isPending ? (
            <SkeletonGroup label={tc('loading')}>
              <Skeleton className="h-64 w-full" />
            </SkeletonGroup>
          ) : dash.isError ? (
            <ErrorState compact error={dash.error} onRetry={() => void dash.refetch()} />
          ) : dash.data.series.every((p) => p.count === 0) ? (
            <EmptyState compact title={t('chartEmpty')} />
          ) : (
            <VolumeChart series={dash.data.series} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('recentPayments')}</CardTitle>
          <Link href="/merchant/payments" className="text-sm text-accent-text hover:underline">
            {tc('viewAll')}
          </Link>
        </CardHeader>
        <CardContent>
          {payments.isPending ? (
            <ListSkeleton rows={5} label={tc('loading')} />
          ) : payments.isError ? (
            <ErrorState compact error={payments.error} onRetry={() => void payments.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState compact title={t('noPayments')} body={t('noPaymentsBody')} />
          ) : (
            <PaymentsTable items={recent} onOpen={setOpen} compact />
          )}
        </CardContent>
      </Card>

      <PaymentDrawer payment={open} onClose={() => setOpen(null)} />
    </>
  );
}
