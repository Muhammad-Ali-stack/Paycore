'use client';

/**
 * 14-day volume bars. Recharts needs numbers for geometry, so amounts are
 * converted with minorToChartNumber() for plotting only; every tick and tooltip
 * is formatted from minor units. A visually hidden table carries the same data.
 */
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import type { Money } from '@/lib/api/contracts/common';
import { formatMinor, minorToChartNumber } from '@/lib/money';
import { color } from '@/design/tokens';
import { Amount } from '@/components/money/amount';
import { useDates } from './hooks';

type Point = { date: string; volume: Money; count: number };

export function VolumeChart({ series }: { series: Point[] }) {
  const t = useTranslations('merchant');
  const locale = useLocale() === 'ur' ? 'ur' : 'en';
  const reduce = useReducedMotion();
  const dates = useDates();
  const currency = series[0]?.volume.currency ?? 'PKR';
  const rows = series.map((p) => ({
    label: dates.short(`${p.date}T00:00:00Z`),
    value: minorToChartNumber(p.volume.amountMinor, p.volume.currency),
    money: p.volume,
    count: p.count,
  }));
  const fmtTick = (v: number) => formatMinor(`${Math.round(v)}00`, currency, { locale, trimZeroFraction: true });

  return (
    <div>
      <div role="img" aria-label={t('volumeChartLabel')} className="h-64" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke={color.chartGrid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
              tick={{ fill: color.fgMuted, fontSize: 11 }}
            />
            <YAxis
              width={76}
              tickLine={false}
              axisLine={false}
              tick={{ fill: color.fgMuted, fontSize: 11 }}
              tickFormatter={(v: number) => safeTick(fmtTick, v)}
            />
            <Tooltip
              cursor={{ fill: color.accentTint }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                if (!d) return null;
                return (
                  <div className="rounded-md border border-border bg-raised px-3 py-2 text-xs shadow-card">
                    <p className="mb-1 font-medium text-fg">{d.label}</p>
                    <p className="money text-fg">{formatMinor(d.money.amountMinor, d.money.currency, { locale })}</p>
                    <p className="text-fg-muted">
                      {t('chartCount')}: {d.count}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              fill={color.accent}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={!reduce}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{t('volume14')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('chartDay')}</th>
            <th scope="col">{t('chartVolume')}</th>
            <th scope="col">{t('chartCount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                <Amount money={r.money} />
              </td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function safeTick(fn: (v: number) => string, v: number) {
  try {
    return fn(v);
  } catch {
    return String(v);
  }
}
