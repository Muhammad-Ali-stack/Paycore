'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Receipt,
  RotateCcw,
  Store,
} from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states/states';
import { CopyButton } from '@/components/ui/copy-button';
import type { ActivityItem } from '@/lib/api/contracts/phase2';
import { payments } from '@/lib/api/services';
import { cn, shortId } from '@/lib/utils';

function ActivityIcon({ item }: { item: ActivityItem }) {
  const cls = 'size-4';
  switch (item.type) {
    case 'TOPUP':
    case 'DEPOSIT':
    case 'WITHDRAWAL':
      return <Banknote className={cls} />;
    case 'WITHDRAWAL_REVERSAL':
    case 'REFUND':
      return <RotateCcw className={cls} />;
    case 'QR_MERCHANT':
      return <Store className={cls} />;
    case 'BILL':
      return <Receipt className={cls} />;
    case 'CARD':
      return <CreditCard className={cls} />;
    case 'FX_CONVERSION':
      return <ArrowLeftRight className={cls} />;
    default:
      return item.direction === 'IN' ? <ArrowDownLeft className={cls} /> : <ArrowUpRight className={cls} />;
  }
}

export function useTypeLabel() {
  const t = useTranslations('tx.types');
  return (type: string) => {
    const key = type as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : type;
  };
}

export function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen?: (item: ActivityItem) => void }) {
  const format = useFormatter();
  const typeLabel = useTypeLabel();
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen?.(item)}
        className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-start transition-colors hover:bg-raised"
        data-testid="activity-row"
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full border',
            item.direction === 'IN'
              ? 'border-success/30 bg-success-tint text-success'
              : 'border-border bg-raised text-fg-muted',
          )}
        >
          <ActivityIcon item={item} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
          <span className="block truncate text-xs text-fg-muted">
            {typeLabel(item.type)} ·{' '}
            {format.dateTime(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <Amount money={item.amount} direction={item.direction} className="font-medium" />
          {item.status !== 'COMPLETED' ? <StatusBadge status={item.status} /> : null}
        </span>
      </button>
    </li>
  );
}

/** Groups by day with sticky-free headers ("Today", "Yesterday", date). */
export function ActivityGroups({ items, onOpen }: { items: ActivityItem[]; onOpen: (item: ActivityItem) => void }) {
  const format = useFormatter();
  const t = useTranslations('common');
  const groups = React.useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of items) {
      const key = it.createdAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()];
  }, [items]);
  const [{ today, yesterday }] = React.useState(() => ({
    today: new Date().toISOString().slice(0, 10),
    yesterday: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  }));
  return (
    <div className="grid gap-4">
      {groups.map(([day, rows]) => (
        <section key={day} aria-label={day}>
          <h3 className="px-2 pb-1 text-xs font-medium tracking-wider text-fg-muted uppercase">
            {day === today
              ? t('today')
              : day === yesterday
                ? t('yesterday')
                : format.dateTime(new Date(day), { dateStyle: 'full' })}
          </h3>
          <ul className="divide-y divide-border/60">
            {rows.map((it) => (
              <ActivityRow key={it.id} item={it} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Transaction detail drawer. Loads the Payment (timeline, fees) when there is one. */
export function ActivityDrawer({ item, onClose }: { item: ActivityItem | null; onClose: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const typeLabel = useTypeLabel();
  const payment = useQuery({
    queryKey: ['payment', item?.paymentId],
    queryFn: () => payments.get(item!.paymentId!),
    enabled: Boolean(item?.paymentId),
  });
  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="end" closeLabel={t('common.close')} aria-describedby={undefined}>
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tx.detailTitle')}</DialogTitle>
              <DialogDescription>{typeLabel(item.type)}</DialogDescription>
            </DialogHeader>
            <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-border bg-raised p-6 text-center">
              <p className="text-sm text-fg-muted">{item.title}</p>
              <Amount money={item.amount} direction={item.direction} size="xl" />
              <StatusBadge status={payment.data?.status ?? item.status} />
            </div>
            <DetailList>
              {item.counterparty ? (
                <DetailRow label={t('tx.counterparty')}>
                  {item.counterparty.displayName}
                  {item.counterparty.username ? (
                    <span className="block text-xs text-fg-muted">@{item.counterparty.username}</span>
                  ) : null}
                  {item.counterparty.outletName ? (
                    <span className="block text-xs text-fg-muted">{item.counterparty.outletName}</span>
                  ) : null}
                </DetailRow>
              ) : null}
              <DetailRow label={t('common.date')}>
                {format.dateTime(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </DetailRow>
              <DetailRow label={t('common.fee')}>{item.fee ? <Amount money={item.fee} /> : t('common.free')}</DetailRow>
              {payment.data?.received && payment.data.received.currency !== payment.data.amount.currency ? (
                <DetailRow label={t('send.theyGet')}>
                  <Amount money={payment.data.received} />
                </DetailRow>
              ) : null}
              {payment.data?.reference ? (
                <DetailRow label={t('common.reference')}>{payment.data.reference}</DetailRow>
              ) : null}
              <DetailRow label={t('tx.balanceAfter')}>
                <Amount money={item.balanceAfter} hideable />
              </DetailRow>
              <DetailRow label={t('common.id')}>
                <span className="code text-xs">{shortId(item.paymentId ?? item.transactionId ?? item.id)}</span>
              </DetailRow>
            </DetailList>
            {item.paymentId ? (
              <section className="mt-6" aria-labelledby="timeline-h">
                <h3 id="timeline-h" className="mb-3 text-sm font-semibold">
                  {t('tx.timeline')}
                </h3>
                {payment.isPending ? (
                  <Skeleton className="h-20" />
                ) : payment.isError ? (
                  <ErrorState compact error={payment.error} onRetry={() => void payment.refetch()} />
                ) : (
                  <ol className="relative grid gap-3 border-s border-border ps-4">
                    {payment.data.timeline.map((e, i) => (
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
                )}
              </section>
            ) : null}
            <div className="mt-6">
              <CopyButton value={item.paymentId ?? item.id} label={t('send.paymentId')} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
