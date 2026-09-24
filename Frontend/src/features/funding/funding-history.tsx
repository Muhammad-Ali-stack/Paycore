'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, QueryState } from '@/components/states/states';
import { useFundingList } from '@/lib/api/hooks';

export function FundingHistory() {
  const t = useTranslations();
  const format = useFormatter();
  const q = useFundingList();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('funding.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={q}
          skeleton={<ListSkeleton rows={3} label={t('states.loadingList')} />}
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState compact title={t('funding.noHistory')} />}
        >
          {(page) => (
            <ul className="divide-y divide-border/60">
              {page.items.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/funding/${f.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-raised"
                  >
                    <span
                      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-raised text-fg-muted"
                      aria-hidden
                    >
                      {f.direction === 'TOPUP' ? (
                        <ArrowDownToLine className="size-4" />
                      ) : (
                        <ArrowUpFromLine className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {f.direction === 'TOPUP' ? t('funding.topupTitle') : t('funding.withdrawTitle')}
                      </span>
                      <span className="block text-xs text-fg-muted">
                        {format.dateTime(new Date(f.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Amount money={f.amount} direction={f.direction === 'TOPUP' ? 'IN' : 'OUT'} />
                      <StatusBadge status={f.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
