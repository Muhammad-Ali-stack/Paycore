'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Segmented, Select } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState, InlineError } from '@/components/states/states';
import { ActivityDrawer, ActivityGroups } from '@/features/activity/activity-list';
import { useActivity, useWallets } from '@/lib/api/hooks';
import { activity } from '@/lib/api/services';
import type { ActivityItem } from '@/lib/api/contracts/phase2';
import { downloadBlob } from '@/lib/utils';

const TYPES = [
  'P2P',
  'P2P_FX',
  'REQUEST',
  'QR_MERCHANT',
  'QR_P2P',
  'TOPUP',
  'WITHDRAWAL',
  'REFUND',
  'FX_CONVERSION',
  'REVERSAL',
] as const;

export default function ActivityPage() {
  const t = useTranslations();
  const walletsQ = useWallets();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [walletId, setWalletId] = React.useState('ALL');
  const [direction, setDirection] = React.useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [type, setType] = React.useState<(typeof TYPES)[number] | 'ALL'>('ALL');
  const [open, setOpen] = React.useState<ActivityItem | null>(null);
  const [statementOpen, setStatementOpen] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const feed = useActivity({
    q: debounced || undefined,
    walletId: walletId === 'ALL' ? undefined : walletId,
    direction: direction === 'ALL' ? undefined : direction,
    type: type === 'ALL' ? undefined : type,
  });

  // Infinite scroll: load the next page when the sentinel becomes visible.
  const sentinel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [feed]);

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const hasFilters = Boolean(debounced) || walletId !== 'ALL' || direction !== 'ALL' || type !== 'ALL';

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('tx.title')}
        description={t('tx.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => setStatementOpen(true)}>
            <Download aria-hidden /> {t('tx.statement')}
          </Button>
        }
      />
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="tx-search" className="text-sm font-medium">
              {t('tx.searchLabel')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-3.5 size-4 text-fg-muted" aria-hidden />
              <Input
                id="tx-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('tx.searchPlaceholder')}
                className="ps-9"
                data-testid="tx-search"
              />
            </div>
          </div>
          <Field label={t('common.wallet')}>
            <Select
              value={walletId}
              onValueChange={setWalletId}
              options={[
                { value: 'ALL', label: t('tx.allWallets') },
                ...(walletsQ.data ?? []).map((w) => ({ value: w.id, label: w.currency })),
              ]}
            />
          </Field>
          <Field label={t('tx.type')}>
            <Select
              value={type}
              onValueChange={(v) => setType(v as typeof type)}
              options={[
                { value: 'ALL', label: t('common.all') },
                ...TYPES.map((ty) => ({ value: ty, label: t(`tx.types.${ty}`) })),
              ]}
            />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t('tx.direction')}</span>
            <Segmented
              label={t('tx.direction')}
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'ALL', label: t('common.all') },
                { value: 'IN', label: t('tx.in') },
                { value: 'OUT', label: t('tx.out') },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {feed.isPending ? (
            <ListSkeleton rows={8} label={t('states.loadingList')} />
          ) : feed.isError ? (
            <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('tx.empty') : t('home.noActivity')}
              body={hasFilters ? t('tx.emptyBody') : t('home.noActivityBody')}
              action={
                hasFilters ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQ('');
                      setWalletId('ALL');
                      setDirection('ALL');
                      setType('ALL');
                    }}
                  >
                    {t('common.clear')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ActivityGroups items={items} onOpen={setOpen} />
              <div ref={sentinel} className="flex justify-center py-4">
                {feed.isFetchingNextPage ? (
                  <Spinner label={t('common.loading')} />
                ) : feed.hasNextPage ? (
                  <Button variant="ghost" size="sm" onClick={() => void feed.fetchNextPage()}>
                    {t('common.loadMore')}
                  </Button>
                ) : (
                  <p className="text-xs text-fg-muted">{t('states.endOfList')}</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
      <StatementDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        walletId={walletId === 'ALL' ? undefined : walletId}
      />
    </div>
  );
}

function StatementDialog({
  open,
  onOpenChange,
  walletId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  walletId?: string;
}) {
  const t = useTranslations();
  const [today] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = React.useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = React.useState(today);
  const [format, setFormat] = React.useState<'csv' | 'pdf'>('csv');
  const dl = useMutation({
    // The API's `to` is exclusive; the date picker is inclusive, so send the next day.
    mutationFn: () =>
      activity.statement({
        walletId,
        from: `${from}T00:00:00.000Z`,
        to: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString(),
        format,
      }),
    onSuccess: (blob) => {
      downloadBlob(blob, `paycore-statement-${from}-to-${to}.${format}`);
      toast.success(t('tx.downloadStarted'));
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('tx.statementTitle')}</DialogTitle>
          <DialogDescription>{t('tx.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('tx.from')}>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('tx.to')}>
              <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t('tx.format')}</span>
            <Segmented
              label={t('tx.format')}
              value={format}
              onChange={setFormat}
              options={[
                { value: 'csv', label: t('tx.csv') },
                { value: 'pdf', label: t('tx.pdf') },
              ]}
            />
          </div>
          {dl.error ? <InlineError error={dl.error} /> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => dl.mutate()} loading={dl.isPending}>
            <Download aria-hidden /> {t('common.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
