'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented, Select } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, QueryState } from '@/components/states/states';
import { Donut, InOutBars, paletteAt, toData } from '@/features/charts/charts';
import { useCurrencies, useSpending, useTrend, useWallets } from '@/lib/api/hooks';
import type { Currency } from '@/lib/api/contracts/common';
import { formatShare } from '@/lib/money';

type Period = '30' | '90' | '365';

export default function AnalyticsPage() {
  const t = useTranslations();
  const format = useFormatter();
  const walletsQ = useWallets();
  const [currency, setCurrency] = React.useState<Currency>('PKR');
  const [period, setPeriod] = React.useState<Period>('30');
  const [groupBy, setGroupBy] = React.useState<'CATEGORY' | 'MERCHANT'>('CATEGORY');
  const [today] = React.useState(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  });
  const from = new Date(today - Number(period) * 86400000).toISOString();
  const spending = useSpending(currency, groupBy, from);
  const trend = useTrend(currency, 'MONTH', period === '365' ? 12 : 6);
  const currencies = useCurrencies();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.subtitle')}
        actions={
          <>
            <Select
              aria-label={t('common.currency')}
              value={currency}
              onValueChange={(v) => setCurrency(v as Currency)}
              options={(walletsQ.data ?? []).map((w) => ({ value: w.currency, label: w.currency }))}
              className="h-9 w-28"
            />
            <Segmented
              label={t('analytics.period')}
              value={period}
              onChange={setPeriod}
              options={[
                { value: '30', label: t('analytics.days30') },
                { value: '90', label: t('analytics.days90') },
                { value: '365', label: t('analytics.year') },
              ]}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{groupBy === 'CATEGORY' ? t('analytics.byCategory') : t('analytics.byMerchant')}</CardTitle>
            <Segmented
              label={t('analytics.byCategory')}
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'CATEGORY', label: t('analytics.byCategory') },
                { value: 'MERCHANT', label: t('analytics.byMerchant') },
              ]}
            />
          </CardHeader>
          <CardContent>
            <QueryState
              query={spending}
              skeleton={<Skeleton className="h-72" />}
              isEmpty={(d) => d.groups.length === 0}
              empty={<EmptyState compact title={t('analytics.noSpending')} />}
            >
              {(s) => (
                <div className="grid gap-4">
                  <Donut
                    label={t('analytics.chartSummary', {
                      label: groupBy === 'CATEGORY' ? t('analytics.byCategory') : t('analytics.byMerchant'),
                    })}
                    data={toData(s.groups.slice(0, 8).map((g) => ({ label: g.label, money: g.amount })))}
                    centerLabel={
                      <div>
                        <p className="text-xs text-fg-muted">{t('analytics.totalSpent')}</p>
                        <Amount money={s.total} size="md" className="font-semibold" hideable />
                      </div>
                    }
                  />
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('analytics.totalSpent')}</caption>
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">{t('common.details')}</th>
                        <th scope="col">{t('common.amount')}</th>
                        <th scope="col">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.groups.map((g, i) => (
                        <tr key={g.key} className="border-t border-border/60">
                          <th scope="row" className="py-2 text-start font-normal">
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ background: paletteAt(i) }}
                              />
                              <span className="truncate">{g.label}</span>
                              <span className="text-xs text-fg-muted">
                                {t('analytics.transactions', { count: g.count })}
                              </span>
                            </span>
                          </th>
                          <td className="py-2 text-end">
                            <Amount money={g.amount} />
                          </td>
                          <td className="money w-16 py-2 text-end text-fg-muted">{formatShare(g.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.monthlyTrend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryState query={trend} skeleton={<Skeleton className="h-64" />}>
              {(tr) => (
                <InOutBars
                  label={t('analytics.chartSummary', { label: t('analytics.monthlyTrend') })}
                  inLabel={t('analytics.moneyIn')}
                  outLabel={t('analytics.moneyOut')}
                  data={tr.points.map((p) => ({
                    label: format.dateTime(new Date(`${p.period}-01T00:00:00Z`), { month: 'short' }),
                    in: p.in,
                    out: p.out,
                  }))}
                />
              )}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.currencyMix')}</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={currencies} skeleton={<Skeleton className="h-40" />}>
            {(c) => (
              <div className="grid items-center gap-6 md:grid-cols-[280px_1fr]">
                <Donut
                  label={t('analytics.chartSummary', { label: t('analytics.currencyMix') })}
                  data={toData(c.items.map((i) => ({ label: i.currency, money: i.converted })))}
                  centerLabel={<Amount money={c.total} size="sm" className="font-semibold" hideable />}
                />
                <ul className="grid gap-3">
                  {c.items.map((i, idx) => (
                    <li key={i.currency} className="flex items-center gap-3 rounded-md border border-border p-3">
                      <span aria-hidden className="size-3 rounded-full" style={{ background: paletteAt(idx) }} />
                      <span className="w-12 text-sm font-medium">{i.currency}</span>
                      <span className="flex-1">
                        <Amount money={i.balance} hideable />
                        <span className="block text-xs text-fg-muted">
                          ≈ <Amount money={i.converted} size="xs" hideable />
                        </span>
                      </span>
                      <span className="money text-sm text-fg-muted">{formatShare(i.share)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
