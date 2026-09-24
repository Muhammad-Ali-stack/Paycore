'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Amount } from '@/components/money/amount';
import { PageHeader } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, QueryState } from '@/components/states/states';
import { useMerchantRefunds } from '@/lib/api/hooks';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { useDates } from '@/features/merchant/hooks';

export default function MerchantRefundsPage() {
  return <MerchantGate>{() => <Refunds />}</MerchantGate>;
}

function Refunds() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const query = useMerchantRefunds();
  return (
    <>
      <PageHeader title={t('refundsTitle')} description={t('refundsDescription')} />
      <Card>
        <CardContent className="pt-2 sm:pt-3">
          <QueryState
            query={query}
            skeleton={<ListSkeleton rows={6} label={tc('loading')} />}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState title={t('noRefunds')} body={t('noRefundsBody')} />}
          >
            {(d) => (
              <>
                <ul className="divide-y divide-border md:hidden" data-testid="merchant-refunds-list">
                  {d.items.map((r) => (
                    <li key={r.id} className="grid gap-1 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{r.payerName}</span>
                        <Amount money={r.amount} direction="OUT" className="font-medium" />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
                        <span className="truncate">
                          {dates.dateTime(r.createdAt)} · {t('paymentAmount')}{' '}
                          <Amount money={r.paymentAmount} size="xs" />
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-xs text-fg-muted">{r.reason}</p>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-fg-muted">
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {tc('date')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {t('payer')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('paymentAmount')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('refundAmount')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {t('refundReason')}
                        </th>
                        <th scope="col" className="py-2 text-start font-medium">
                          {tc('status')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.items.map((r) => (
                        <tr key={r.id}>
                          <td className="py-3 pe-3 whitespace-nowrap text-fg-muted">{dates.dateTime(r.createdAt)}</td>
                          <td className="py-3 pe-3 font-medium">{r.payerName}</td>
                          <td className="py-3 pe-3 text-end text-fg-muted">
                            <Amount money={r.paymentAmount} />
                          </td>
                          <td className="py-3 pe-3 text-end">
                            <Amount money={r.amount} className="font-medium" />
                          </td>
                          <td className="max-w-64 truncate py-3 pe-3 text-fg-muted" title={r.reason}>
                            {r.reason}
                          </td>
                          <td className="py-3">
                            <StatusBadge status={r.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </>
  );
}
