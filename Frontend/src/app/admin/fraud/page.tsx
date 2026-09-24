'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, QueryState } from '@/components/states/states';
import { useFraudCases } from '@/lib/api/hooks';
import { FraudSeverity, FraudStatus, type FraudCase } from '@/lib/api/contracts/future';
import { FraudCaseDrawer } from '@/features/admin/fraud-drawer';
import { SeverityBadge, useDateTime } from '@/features/admin/shared';

const SEVERITY_ORDER: Record<FraudCase['severity'], number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function CaseRow({ c, onOpen }: { c: FraudCase; onOpen: () => void }) {
  const t = useTranslations();
  const dt = useDateTime();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-md px-3 py-3 text-start transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex w-28 shrink-0">
          <SeverityBadge severity={c.severity} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{c.subject.displayName}</span>
          <span className="block truncate text-xs text-fg-muted">
            <span className="code">{c.ruleCode}</span> · {c.summary}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 text-xs text-fg-muted">
          {c.amount ? <Amount money={c.amount} className="font-medium text-fg" /> : null}
          <span>
            {t('admin.score')}: <span className="money text-fg">{c.score}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <StatusBadge status={c.status} />
          <span className="text-xs text-fg-muted">{c.assignee?.displayName ?? t('admin.unassigned')}</span>
        </span>
        <span className="hidden text-xs text-fg-muted lg:block">{dt(c.createdAt)}</span>
        <ChevronRight className="size-4 text-fg-muted rtl:rotate-180" aria-hidden />
      </button>
    </li>
  );
}

export default function AdminFraudPage() {
  const t = useTranslations();
  const [status, setStatus] = React.useState<string>('ACTIVE');
  const [severity, setSeverity] = React.useState<string>('ALL');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const query = useFraudCases({
    status: status === 'ALL' ? undefined : status,
    severity: severity === 'ALL' ? undefined : severity,
  });

  const statusOptions = [
    { value: 'ACTIVE', label: t('admin.active') },
    { value: 'ALL', label: t('common.all') },
    ...FraudStatus.options.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];
  const severityOptions = [
    { value: 'ALL', label: t('common.all') },
    ...FraudSeverity.options.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];

  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.fraudTitle')} description={t('admin.fraud.subtitle')} />

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('common.status')} className="w-full sm:w-56">
          <Select value={status} onValueChange={setStatus} options={statusOptions} />
        </Field>
        <Field label={t('admin.severity')} className="w-full sm:w-48">
          <Select value={severity} onValueChange={setSeverity} options={severityOptions} />
        </Field>
      </div>

      <Card className="p-2">
        <QueryState
          query={query}
          skeleton={
            <div className="p-3">
              <ListSkeleton rows={5} label={t('states.loadingList')} />
            </div>
          }
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState title={t('admin.fraud.emptyTitle')} body={t('admin.fraud.emptyBody')} />}
        >
          {(d) => (
            <>
              <p className="sr-only" aria-live="polite">
                {t('admin.resultsCount', { count: d.items.length })}
              </p>
              <ul className="divide-y divide-border/60">
                {[...d.items]
                  .sort(
                    (a, b) =>
                      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.createdAt.localeCompare(a.createdAt),
                  )
                  .map((c) => (
                    <CaseRow key={c.id} c={c} onOpen={() => setOpenId(c.id)} />
                  ))}
              </ul>
            </>
          )}
        </QueryState>
      </Card>

      <FraudCaseDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
