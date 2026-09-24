'use client';

import * as React from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, BellRing, HandCoins, KeyRound, Receipt, ScanLine, Send } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ListSkeleton, Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, InlineError, QueryState } from '@/components/states/states';
import { BalanceCarousel } from '@/features/wallets/balance-carousel';
import { KycBanner } from '@/features/kyc/kyc-banner';
import { ActivityDrawer, ActivityRow } from '@/features/activity/activity-list';
import { SparkArea, toData } from '@/features/charts/charts';
import {
  invalidateMoney,
  useActivity,
  useCurrencies,
  useKyc,
  useMe,
  useQueryClient,
  useRequests,
  useTrend,
  useWallets,
} from '@/lib/api/hooks';
import { wallets as walletsApi } from '@/lib/api/services';
import type { ActivityItem } from '@/lib/api/contracts/phase2';
import { CURRENCIES, type Currency } from '@/lib/api/contracts/common';
import { addMoney, moneyFromMinor } from '@/lib/money';

export default function HomePage() {
  const t = useTranslations();
  const format = useFormatter();
  const me = useMe();
  const walletsQ = useWallets();
  const currencies = useCurrencies();
  const kyc = useKyc();
  const incoming = useRequests('INCOMING');
  const [index, setIndex] = React.useState(0);
  const [addOpen, setAddOpen] = React.useState(false);
  const [open, setOpen] = React.useState<ActivityItem | null>(null);
  const wallet = walletsQ.data?.[index] ?? walletsQ.data?.[0];
  const currency: Currency = wallet?.currency ?? 'PKR';
  const recent = useActivity({ limit: 5 });
  const trend = useTrend(currency, 'DAY', 7);
  const pendingRequests = incoming.data?.items.filter((r) => r.status === 'PENDING') ?? [];

  const firstName = me.data?.fullName.split(' ')[0];
  const actions = [
    { href: '/send', label: t('nav.send'), icon: Send },
    { href: '/scan', label: t('home.scan'), icon: ScanLine },
    { href: '/requests', label: t('nav.request'), icon: HandCoins },
    { href: '/topup', label: t('nav.topup'), icon: ArrowDownToLine },
    { href: '/bills', label: t('home.payBill'), icon: Receipt },
  ];

  const spent7 = React.useMemo(() => {
    if (!trend.data) return null;
    return trend.data.points.reduce((s, p) => addMoney(s, p.out), moneyFromMinor(0n, trend.data.currency));
  }, [trend.data]);

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {firstName ? (
              t('home.greeting', { name: firstName })
            ) : (
              <span aria-hidden className="skeleton inline-block h-7 w-40 rounded-md" />
            )}
          </h1>
        </div>
      </header>

      {/* Total in preferred currency */}
      <section aria-labelledby="total-h" className="balance-surface rounded-xl border border-border p-6 shadow-card">
        <h2 id="total-h" className="text-sm text-fg-muted">
          {t('home.totalBalance')}
        </h2>
        {currencies.isPending ? (
          <SkeletonGroup label={t('common.loading')}>
            <Skeleton className="mt-2 h-12 w-64" />
          </SkeletonGroup>
        ) : currencies.isError ? (
          <ErrorState compact error={currencies.error} onRetry={() => void currencies.refetch()} className="mt-3" />
        ) : (
          <>
            <p className="mt-1" data-testid="total-balance">
              <Amount money={currencies.data.total} size="hero" hideable className="text-accent-text" />
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {t('home.inPreferred', { currency: currencies.data.preferredCurrency })}
            </p>
          </>
        )}
        <nav aria-label={t('home.quickActions')} className="mt-6">
          <ul className="grid grid-cols-5 gap-2 sm:max-w-lg">
            {actions.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center text-xs font-medium text-fg-muted hover:text-fg"
                >
                  <span className="inline-flex size-12 items-center justify-center rounded-full border border-border bg-raised text-accent transition-colors group-hover:border-accent/50 group-hover:bg-accent-tint">
                    <a.icon className="size-5" aria-hidden />
                  </span>
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      {pendingRequests.length ? (
        <Link
          href="/requests"
          className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-tint px-4 py-3 text-sm hover:border-accent/60"
        >
          <BellRing className="size-4 text-accent" aria-hidden />
          <span className="flex-1">{t('home.pendingRequests', { count: pendingRequests.length })}</span>
          <span className="font-medium text-accent-text">{t('home.review')}</span>
        </Link>
      ) : null}

      {me.data && !me.data.pinSet ? (
        <Link
          href="/setup-pin"
          className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-tint px-4 py-3 text-sm hover:border-warning/60"
        >
          <KeyRound className="size-4 text-warning" aria-hidden />
          <span className="flex-1">{t('profile.pinNotSet')}</span>
          <span className="font-medium text-warning">{t('profile.setPin')}</span>
        </Link>
      ) : null}

      <QueryState
        query={walletsQ}
        skeleton={
          <SkeletonGroup label={t('common.loading')}>
            <div className="flex gap-3">
              <Skeleton className="h-44 w-[82%] rounded-xl sm:w-1/2" />
              <Skeleton className="hidden h-44 w-1/2 rounded-xl sm:block" />
            </div>
          </SkeletonGroup>
        }
      >
        {(ws) => (
          <BalanceCarousel wallets={ws} index={index} onIndexChange={setIndex} onAddWallet={() => setAddOpen(true)} />
        )}
      </QueryState>

      {kyc.data ? <KycBanner kyc={kyc.data} currency={currency} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('home.recent')}</CardTitle>
            <Link href="/activity" className="text-sm text-accent-text hover:underline">
              {t('common.viewAll')}
            </Link>
          </CardHeader>
          <CardContent>
            {recent.isPending ? (
              <ListSkeleton rows={4} label={t('states.loadingList')} />
            ) : recent.isError ? (
              <ErrorState compact error={recent.error} onRetry={() => void recent.refetch()} />
            ) : recent.data.pages[0]?.items.length ? (
              <ul className="divide-y divide-border/60" data-testid="recent-activity">
                {recent.data.pages[0].items.map((it) => (
                  <ActivityRow key={it.id} item={it} onOpen={setOpen} />
                ))}
              </ul>
            ) : (
              <EmptyState compact title={t('home.noActivity')} body={t('home.noActivityBody')} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('home.spending')}</CardTitle>
            <span className="text-xs text-fg-muted">{currency}</span>
          </CardHeader>
          <CardContent>
            {trend.isPending ? (
              <Skeleton className="h-32" />
            ) : trend.isError ? (
              <ErrorState compact error={trend.error} onRetry={() => void trend.refetch()} />
            ) : (
              <>
                <p className="text-xs text-fg-muted">{t('home.spent')}</p>
                {spent7 ? <Amount money={spent7} size="lg" hideable /> : null}
                <SparkArea
                  label={t('analytics.chartSummary', { label: t('home.spending') })}
                  data={toData(
                    trend.data.points.map((p) => ({
                      label: format.dateTime(new Date(p.period), { weekday: 'short' }),
                      money: p.out,
                    })),
                  )}
                  height={120}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AddWalletDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existing={walletsQ.data?.map((w) => w.currency) ?? []}
      />
      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function AddWalletDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Currency[];
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (c: Currency) => walletsApi.create(c),
    onSuccess: async (w) => {
      toast.success(t('home.walletCreated', { currency: w.currency }));
      await invalidateMoney(qc);
      onOpenChange(false);
    },
  });
  const available = CURRENCIES.filter((c) => !existing.includes(c));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('home.addWalletTitle')}</DialogTitle>
          <DialogDescription>{t('home.addWalletBody')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {available.length ? (
            available.map((c) => (
              <Button
                key={c}
                variant="secondary"
                size="lg"
                loading={create.isPending && create.variables === c}
                onClick={() => create.mutate(c)}
              >
                {c}
              </Button>
            ))
          ) : (
            <p className="text-sm text-fg-muted">{t('states.emptyTitle')}</p>
          )}
          {create.error ? <InlineError error={create.error} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
