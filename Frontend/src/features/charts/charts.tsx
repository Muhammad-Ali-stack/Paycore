'use client';

/**
 * Recharts wrappers themed with tokens. Geometry needs numbers, so amounts are
 * converted with minorToChartNumber() for plotting only; every label, tick and
 * tooltip is formatted from minor units via formatMinor().
 */
import * as React from 'react';
import { useLocale } from 'next-intl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from 'framer-motion';
import type { Money } from '@/lib/api/contracts/common';
import { formatMinor, minorToChartNumber } from '@/lib/money';
import { chartPalette, color } from '@/design/tokens';

type Datum = { label: string; value: number; money: Money };

function useFmt() {
  const locale = useLocale() === 'ur' ? 'ur' : 'en';
  return (m: Money, compact = false) =>
    formatMinor(compact ? m.amountMinor.replace(/\d{2}$/, '00') : m.amountMinor, m.currency, {
      locale,
      trimZeroFraction: compact,
    });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Datum; name?: string; color?: string }[];
}) {
  const fmt = useFmt();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-raised px-3 py-2 text-xs shadow-card">
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: p.color ?? color.accent }} />
          <span className="text-fg-muted">{p.payload.label}</span>
          <span className="money ms-auto font-medium text-fg">{fmt(p.payload.money)}</span>
        </div>
      ))}
    </div>
  );
}

export function toData(points: { label: string; money: Money }[]): Datum[] {
  return points.map((p) => ({
    label: p.label,
    money: p.money,
    value: minorToChartNumber(p.money.amountMinor, p.money.currency),
  }));
}

export function SparkArea({ data, height = 96, label }: { data: Datum[]; height?: number; label: string }) {
  const reduce = useReducedMotion();
  const id = React.useId().replace(/:/g, '');
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: color.border }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color.accent}
            strokeWidth={2}
            fill={`url(#g${id})`}
            isAnimationActive={!reduce}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InOutBars({
  data,
  inLabel,
  outLabel,
  label,
}: {
  data: { label: string; in: Money; out: Money }[];
  inLabel: string;
  outLabel: string;
  label: string;
}) {
  const reduce = useReducedMotion();
  const fmt = useFmt();
  const rows = data.map((d) => ({
    label: d.label,
    in: minorToChartNumber(d.in.amountMinor, d.in.currency),
    out: minorToChartNumber(d.out.amountMinor, d.out.currency),
    inMoney: d.in,
    outMoney: d.out,
  }));
  const currency = data[0]?.in.currency ?? 'PKR';
  return (
    <div role="img" aria-label={label} className="h-64" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={4}>
          <CartesianGrid vertical={false} stroke={color.chartGrid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: color.fgMuted, fontSize: 12 }} />
          <YAxis
            width={72}
            tickLine={false}
            axisLine={false}
            tick={{ fill: color.fgMuted, fontSize: 11 }}
            tickFormatter={(v: number) =>
              fmt({ currency: currency as Money['currency'], amount: '', amountMinor: `${Math.round(v)}00` }, true)
            }
          />
          <Tooltip
            cursor={{ fill: color.accentTint }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-md border border-border bg-raised px-3 py-2 text-xs shadow-card">
                  <p className="mb-1 font-medium text-fg">{String(payload[0]?.payload.label)}</p>
                  <p className="text-success">
                    {inLabel}: <span className="money">{fmt(payload[0]?.payload.inMoney as Money)}</span>
                  </p>
                  <p className="text-fg">
                    {outLabel}: <span className="money">{fmt(payload[0]?.payload.outMoney as Money)}</span>
                  </p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="in" name={inLabel} fill={chartPalette[2]} radius={[4, 4, 0, 0]} isAnimationActive={!reduce} />
          <Bar dataKey="out" name={outLabel} fill={chartPalette[0]} radius={[4, 4, 0, 0]} isAnimationActive={!reduce} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data, label, centerLabel }: { data: Datum[]; label: string; centerLabel?: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div role="img" aria-label={label} className="relative h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke={color.surface}
            isAnimationActive={!reduce}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerLabel ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
          {centerLabel}
        </div>
      ) : null}
    </div>
  );
}

export function paletteAt(i: number) {
  return chartPalette[i % chartPalette.length]!;
}
