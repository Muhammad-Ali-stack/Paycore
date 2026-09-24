'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, ClipboardCheck, ShieldAlert, UserCheck, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonGroup } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states/states';
import { useAdminMerchants, useApprovals, useAudit, useFraudCases, useKycQueue } from '@/lib/api/hooks';
import { AuditSkeletonRows, AuditTable } from '@/features/admin/audit';

type CountQuery = { isPending: boolean; isError: boolean; refetch: () => unknown };

function StatCard({
  href,
  label,
  icon: Icon,
  query,
  count,
  more,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  query: CountQuery;
  count: number | undefined;
  more?: boolean;
}) {
  const t = useTranslations();
  return (
    <Card className="relative flex flex-col gap-3 p-5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-fg-muted">{label}</span>
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-raised text-accent-text"
        >
          <Icon className="size-4" />
        </span>
      </div>
      {query.isPending ? (
        <SkeletonGroup label={t('common.loading')}>
          <div aria-hidden className="skeleton h-9 w-16 rounded-md" />
        </SkeletonGroup>
      ) : query.isError ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-danger">{t('states.errorTitle')}</span>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()} className="relative z-10">
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <p className="money text-3xl font-semibold tracking-tight text-fg">
          {count ?? 0}
          {more ? '+' : ''}
        </p>
      )}
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-sm text-accent-text after:absolute after:inset-0 after:rounded-lg hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t('admin.overview.openQueue')}
        <span className="sr-only">: {label}</span>
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
      </Link>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const t = useTranslations();
  const kyc = useKycQueue('PENDING');
  const fraud = useFraudCases({ status: 'ACTIVE' });
  const approvals = useApprovals('PENDING');
  const merchants = useAdminMerchants('PENDING_REVIEW');
  const audit = useAudit({});

  const latest = audit.data?.pages[0]?.items.slice(0, 8);

  return (
    <div className="grid gap-8">
      <PageHeader title={t('admin.title')} description={t('admin.overviewSubtitle')} />

      <section aria-label={t('admin.overview.queues')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          href="/admin/kyc"
          label={t('admin.pendingKyc')}
          icon={UserCheck}
          query={kyc}
          count={kyc.data?.length}
        />
        <StatCard
          href="/admin/fraud"
          label={t('admin.openFraud')}
          icon={ShieldAlert}
          query={fraud}
          count={fraud.data?.items.length}
          more={Boolean(fraud.data?.nextCursor)}
        />
        <StatCard
          href="/admin/approvals"
          label={t('admin.pendingApprovals')}
          icon={ClipboardCheck}
          query={approvals}
          count={approvals.data?.items.length}
          more={Boolean(approvals.data?.nextCursor)}
        />
        <StatCard
          href="/admin/merchants"
          label={t('admin.merchantsPending')}
          icon={Building2}
          query={merchants}
          count={merchants.data?.items.length}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.overview.latestAudit')}</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/audit">
              {t('common.viewAll')}
              <ArrowRight className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {audit.isPending ? (
            <SkeletonGroup label={t('states.loadingList')}>
              <AuditSkeletonRows rows={5} />
            </SkeletonGroup>
          ) : audit.isError ? (
            <ErrorState error={audit.error} onRetry={() => void audit.refetch()} compact />
          ) : !latest?.length ? (
            <EmptyState compact title={t('admin.audit.emptyTitle')} />
          ) : (
            <AuditTable events={latest} compact />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
