'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, QueryState } from '@/components/states/states';
import { useAdminMerchants, useQueryClient } from '@/lib/api/hooks';
import { admin } from '@/lib/api/services';
import type { Merchant } from '@/lib/api/contracts/phase2';
import { ConfirmDialog, Td, Th, bpsToPercent, useDateTime } from '@/features/admin/shared';

const FILTERS = ['ALL', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED'] as const;
type Filter = (typeof FILTERS)[number];
type Pending = { merchant: Merchant; kind: 'approve' | 'suspend' };

function MerchantAction({ m, onAction }: { m: Merchant; onAction: (p: Pending) => void }) {
  const t = useTranslations('admin');
  if (m.status === 'PENDING_REVIEW')
    return (
      <Button size="sm" onClick={() => onAction({ merchant: m, kind: 'approve' })}>
        {t('approve')}
        <span className="sr-only">: {m.businessName}</span>
      </Button>
    );
  if (m.status === 'ACTIVE')
    return (
      <Button size="sm" variant="danger" onClick={() => onAction({ merchant: m, kind: 'suspend' })}>
        {t('merchants.suspend')}
        <span className="sr-only">: {m.businessName}</span>
      </Button>
    );
  return null;
}

export default function AdminMerchantsPage() {
  const t = useTranslations();
  const dt = useDateTime();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const query = useAdminMerchants(filter === 'ALL' ? undefined : filter);
  const [pending, setPending] = React.useState<Pending | null>(null);

  const delay = (d: number) => t('admin.merchants.delayDays', { count: d });

  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.merchantsTitle')} description={t('admin.merchants.subtitle')} />

      <div className="overflow-x-auto">
        <Segmented<Filter>
          label={t('common.status')}
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: f === 'ALL' ? t('common.all') : t(`status.${f}`) }))}
        />
      </div>

      <QueryState
        query={query}
        skeleton={<ListSkeleton rows={5} label={t('states.loadingList')} />}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={t('admin.merchants.emptyTitle')} />}
      >
        {({ items }) => (
          <>
            <Card className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse">
                <caption className="sr-only">{t('admin.merchantsTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t('admin.merchants.business')}</Th>
                    <Th>{t('admin.merchants.mcc')}</Th>
                    <Th>{t('admin.merchants.settlementCurrency')}</Th>
                    <Th className="text-end">{t('admin.merchants.mdr')}</Th>
                    <Th>{t('admin.merchants.settlementDelay')}</Th>
                    <Th>{t('common.status')}</Th>
                    <Th className="text-end">
                      <span className="sr-only">{t('admin.search.actionsCol')}</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.id} className="border-b border-border/60 last:border-0">
                      <Td>
                        <span className="block font-medium">{m.businessName}</span>
                        <span className="block text-xs text-fg-muted">
                          {m.kybTier} · {dt(m.createdAt, 'date')}
                        </span>
                      </Td>
                      <Td className="code">{m.category}</Td>
                      <Td>{m.settlementCurrency}</Td>
                      <Td className="money text-end">{bpsToPercent(m.mdrBps)}</Td>
                      <Td>{delay(m.settlementDelayDays)}</Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td className="text-end">
                        <MerchantAction m={m} onAction={setPending} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <ul className="grid gap-2 md:hidden">
              {items.map((m) => (
                <li key={m.id} className="grid gap-2 rounded-md border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium text-fg">{m.businessName}</p>
                    <StatusBadge status={m.status} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-fg-muted">{t('admin.merchants.mcc')}</dt>
                    <dd className="code text-end">{m.category}</dd>
                    <dt className="text-fg-muted">{t('admin.merchants.settlementCurrency')}</dt>
                    <dd className="text-end">{m.settlementCurrency}</dd>
                    <dt className="text-fg-muted">{t('admin.merchants.mdr')}</dt>
                    <dd className="money text-end">{bpsToPercent(m.mdrBps)}</dd>
                    <dt className="text-fg-muted">{t('admin.merchants.settlementDelay')}</dt>
                    <dd className="text-end">{delay(m.settlementDelayDays)}</dd>
                  </dl>
                  <div className="flex justify-end">
                    <MerchantAction m={m} onAction={setPending} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'suspend' ? t('admin.merchants.suspendTitle') : t('admin.merchants.approveTitle')}
        description={
          pending
            ? pending.kind === 'suspend'
              ? t('admin.merchants.suspendBody', { name: pending.merchant.businessName })
              : t('admin.merchants.approveBody', { name: pending.merchant.businessName })
            : ''
        }
        tone={pending?.kind === 'suspend' ? 'danger' : 'primary'}
        confirmLabel={pending?.kind === 'suspend' ? t('admin.merchants.suspend') : t('admin.approve')}
        onConfirm={async () => {
          const p = pending!;
          if (p.kind === 'approve') await admin.approveMerchant(p.merchant.id);
          else await admin.suspendMerchant(p.merchant.id);
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['admin', 'merchants'] }),
            qc.invalidateQueries({ queryKey: ['admin', 'audit'] }),
          ]);
          toast.success(
            p.kind === 'approve' ? t('admin.merchants.approvedToast') : t('admin.merchants.suspendedToast'),
          );
        }}
      />
    </div>
  );
}
