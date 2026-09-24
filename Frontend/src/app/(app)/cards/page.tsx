'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, Plus, Snowflake, Sun, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Progress, Segmented, Switch } from '@/components/ui/primitives';
import { ListSkeleton, Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, InlineError, QueryState } from '@/components/states/states';
import { PinSheet } from '@/components/pin-sheet';
import { VirtualCard } from '@/features/cards/virtual-card';
import { WalletSelect } from '@/features/wallets/wallet-select';
import { qk, useCardTxns, useCards, useQueryClient, useWallets } from '@/lib/api/hooks';
import { cards as cardsApi } from '@/lib/api/services';
import type { Card as CardT, CardSecrets, CardType } from '@/lib/api/contracts/future';
import { isApiError } from '@/lib/api/errors';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { useCountdown } from '@/hooks/use-countdown';
import { compareMinor, minorToDecimalString, parseAmountInput } from '@/lib/money';

export default function CardsPage() {
  const t = useTranslations();
  const q = useCards();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const selected = q.data?.find((c) => c.id === selectedId) ?? q.data?.[0];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('cards.title')}
        description={t('cards.subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> {t('cards.newCard')}
          </Button>
        }
      />
      <QueryState
        query={q}
        skeleton={
          <SkeletonGroup label={t('common.loading')} className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[1.586] rounded-xl" />
            ))}
          </SkeletonGroup>
        }
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            title={t('cards.noCards')}
            body={t('cards.noCardsBody')}
            action={<Button onClick={() => setCreateOpen(true)}>{t('cards.newCard')}</Button>}
          />
        }
      >
        {(list) => (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1" aria-label={t('cards.title')}>
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="block w-full rounded-xl text-start"
                    aria-pressed={selected?.id === c.id}
                    aria-label={`${c.label} •••• ${c.last4}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <VirtualCard card={c} selected={selected?.id === c.id} />
                  </button>
                </li>
              ))}
            </ul>
            {selected ? <CardDetail key={selected.id} card={selected} /> : null}
          </div>
        )}
      </QueryState>
      <CreateCardDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(c) => setSelectedId(c.id)} />
    </div>
  );
}

function CardDetail({ card }: { card: CardT }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [secrets, setSecrets] = React.useState<CardSecrets | null>(null);
  const [revealOpen, setRevealOpen] = React.useState(false);
  const [terminateOpen, setTerminateOpen] = React.useState(false);
  const left = useCountdown(secrets?.hideAt);

  // Auto-hide: at the server's hideAt, and immediately when the tab is hidden.
  React.useEffect(() => {
    if (!secrets) return;
    const id = window.setTimeout(() => setSecrets(null), Math.max(0, Date.parse(secrets.hideAt) - Date.now()));
    return () => window.clearTimeout(id);
  }, [secrets]);
  React.useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && setSecrets(null);
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const reveal = useMutation({
    mutationFn: (pin: string) => cardsApi.reveal(card.id, pin),
    onSuccess: (s) => {
      setSecrets(s);
      setRevealOpen(false);
    },
  });

  // Freeze is non-monetary: optimistic update with rollback.
  const freeze = useMutation({
    mutationFn: (frozen: boolean) => (frozen ? cardsApi.freeze(card.id) : cardsApi.unfreeze(card.id)),
    onMutate: async (frozen) => {
      await qc.cancelQueries({ queryKey: qk.cards });
      const prev = qc.getQueryData<CardT[]>(qk.cards);
      qc.setQueryData<CardT[]>(qk.cards, (old) =>
        old?.map((c) => (c.id === card.id ? { ...c, status: frozen ? 'FROZEN' : 'ACTIVE' } : c)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.cards, ctx.prev),
    onSuccess: (c) => toast.success(c.status === 'FROZEN' ? t('cards.frozen') : t('cards.unfrozen')),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.cards }),
  });

  const terminate = useMutation({
    mutationFn: (pin: string) => cardsApi.terminate(card.id, pin),
    onSuccess: () => {
      toast.success(t('cards.terminated'));
      setTerminateOpen(false);
      void qc.invalidateQueries({ queryKey: qk.cards });
    },
  });

  const spentPct = (() => {
    const monthly = BigInt(card.limits.monthly.amountMinor);
    if (monthly === 0n) return 0;
    return Number((BigInt(card.spentThisMonth.amountMinor) * 100n) / monthly);
  })();

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{card.label}</h2>
              <StatusBadge status={card.status} />
            </div>
            <div className="flex flex-wrap gap-2">
              {secrets ? (
                <Button variant="secondary" onClick={() => setSecrets(null)}>
                  <EyeOff aria-hidden /> {t('cards.hide')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setRevealOpen(true)}
                  disabled={card.status === 'TERMINATED'}
                  data-testid="card-reveal"
                >
                  <Eye aria-hidden /> {t('cards.reveal')}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => freeze.mutate(card.status !== 'FROZEN')}
                loading={freeze.isPending}
                disabled={card.status !== 'ACTIVE' && card.status !== 'FROZEN'}
              >
                {card.status === 'FROZEN' ? <Sun aria-hidden /> : <Snowflake aria-hidden />}
                {card.status === 'FROZEN' ? t('cards.unfreeze') : t('cards.freeze')}
              </Button>
            </div>
          </div>
          {secrets ? (
            <div className="grid gap-3">
              <VirtualCard card={card} secrets={secrets} />
              <p role="status" className="text-xs text-warning">
                {t('cards.autoHide', { s: left })}
              </p>
            </div>
          ) : null}
          {freeze.error ? <InlineError error={freeze.error} /> : null}
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">{t('cards.spentThisMonth')}</span>
              <span>
                <Amount money={card.spentThisMonth} /> /{' '}
                <Amount money={card.limits.monthly} className="text-fg-muted" />
              </span>
            </div>
            <Progress value={spentPct} label={t('cards.spentThisMonth')} />
          </div>
        </CardContent>
      </Card>

      <LimitsCard card={card} />
      <CardTransactions card={card} />

      {card.status !== 'TERMINATED' ? (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={() => setTerminateOpen(true)}>
            <Trash2 aria-hidden /> {t('cards.terminate')}
          </Button>
        </div>
      ) : null}

      <PinSheet
        open={revealOpen}
        onOpenChange={(o) => {
          setRevealOpen(o);
          if (!o) reveal.reset();
        }}
        title={t('cards.revealTitle')}
        confirmLabel={t('cards.reveal')}
        onSubmit={(pin) => reveal.mutate(pin)}
        pending={reveal.isPending}
        error={reveal.error}
      />
      <PinSheet
        open={terminateOpen}
        onOpenChange={(o) => {
          setTerminateOpen(o);
          if (!o) terminate.reset();
        }}
        title={t('cards.terminateTitle')}
        description={t('cards.terminateBody')}
        confirmLabel={t('cards.terminate')}
        onSubmit={(pin) => terminate.mutate(pin)}
        pending={terminate.isPending}
        error={terminate.error}
      />
    </div>
  );
}

function LimitsCard({ card }: { card: CardT }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [per, setPer] = React.useState(card.limits.perTransaction.amount);
  const [daily, setDaily] = React.useState(card.limits.daily.amount);
  const [monthly, setMonthly] = React.useState(card.limits.monthly.amount);
  const [ecommerce, setEcommerce] = React.useState(card.limits.ecommerce);
  const [international, setInternational] = React.useState(card.limits.international);
  const p = [per, daily, monthly].map((v) => parseAmountInput(v, card.currency));
  const allOk = p.every((x) => x.ok);
  const ordered =
    allOk &&
    p[0]!.ok &&
    p[1]!.ok &&
    p[2]!.ok &&
    compareMinor(p[0]!.minor, p[1]!.minor) <= 0 &&
    compareMinor(p[1]!.minor, p[2]!.minor) <= 0;
  const save = useMutation({
    mutationFn: () =>
      cardsApi.updateLimits(card.id, {
        perTransaction: p[0]!.ok ? p[0]!.normalized : '0',
        daily: p[1]!.ok ? p[1]!.normalized : '0',
        monthly: p[2]!.ok ? p[2]!.normalized : '0',
        ecommerce,
        international,
      }),
    onSuccess: () => {
      toast.success(t('cards.limitsSaved'));
      void qc.invalidateQueries({ queryKey: qk.cards });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cards.limits')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ordered) save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['perTransaction', per, setPer],
                ['daily', daily, setDaily],
                ['monthly', monthly, setMonthly],
              ] as const
            ).map(([key, value, set]) => (
              <div key={key} className="grid gap-1.5">
                <label htmlFor={`lim-${key}`} className="text-sm font-medium">
                  {t(`cards.${key}`)}
                </label>
                <AmountInput
                  id={`lim-${key}`}
                  size="md"
                  currency={card.currency}
                  value={value}
                  onValueChange={set}
                  disabled={card.status === 'TERMINATED'}
                />
              </div>
            ))}
          </div>
          {!ordered ? (
            <p role="alert" className="text-xs text-danger">
              {t('cards.limitsOrder')}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
              {t('cards.ecommerce')}
              <Switch checked={ecommerce} onCheckedChange={setEcommerce} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
              {t('cards.international')}
              <Switch checked={international} onCheckedChange={setInternational} />
            </label>
          </div>
          {save.error ? <InlineError error={save.error} /> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="secondary"
              loading={save.isPending}
              disabled={!ordered || card.status === 'TERMINATED'}
            >
              {t('cards.saveLimits')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CardTransactions({ card }: { card: CardT }) {
  const t = useTranslations();
  const format = useFormatter();
  const q = useCardTxns(card.id);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cards.transactions')}</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <ListSkeleton rows={4} label={t('states.loadingList')} />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact title={t('cards.noTransactions')} />
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {rows.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tx.merchantName}</p>
                    <p className="text-xs text-fg-muted">
                      {tx.category} · {format.dateTime(new Date(tx.createdAt), { dateStyle: 'medium' })}
                    </p>
                    {tx.declineReason ? <p className="text-xs text-danger">{tx.declineReason}</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Amount
                      money={tx.amount}
                      direction="OUT"
                      className={tx.status === 'DECLINED' ? 'text-fg-muted line-through' : undefined}
                    />
                    <StatusBadge status={tx.status} />
                  </div>
                </li>
              ))}
            </ul>
            {q.hasNextPage ? (
              <div className="flex justify-center pt-3">
                <Button variant="ghost" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                  {t('common.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CreateCardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (c: CardT) => void;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [type, setType] = React.useState<CardType>('VIRTUAL');
  const [label, setLabel] = React.useState('');
  const [picked, setWalletId] = React.useState('');
  const [cap, setCap] = React.useState('');
  const walletId = picked || walletsQ.data?.[0]?.id || '';
  const wallet = walletsQ.data?.find((w) => w.id === walletId);
  const capParsed = wallet ? parseAmountInput(cap, wallet.currency) : null;

  // Card creation can authorise spend, so it carries an Idempotency-Key too.
  const action = useIdempotentAction((_: void, key: string) =>
    cardsApi.create(
      {
        walletId,
        type,
        label: label.trim(),
        amountCap:
          type === 'SINGLE_USE' && capParsed?.ok ? minorToDecimalString(capParsed.minor, wallet!.currency) : undefined,
      },
      key,
    ),
  );
  // The key is minted on the first submit and reused for retries; closing the dialog resets it.
  const submit = async () => {
    try {
      const c = await action.run();
      toast.success(t('cards.created'));
      await qc.invalidateQueries({ queryKey: qk.cards });
      onCreated(c);
      action.reset(); // next card is a new logical action -> new key
      setLabel('');
      setCap('');
      onOpenChange(false);
    } catch (e) {
      if (!isApiError(e)) throw e;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (action.pending) return;
        if (!o) action.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('cards.createTitle')}</DialogTitle>
          <DialogDescription>
            {type === 'VIRTUAL' ? t('cards.virtualHint') : t('cards.singleUseHint')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim() && walletId) void submit();
          }}
        >
          <Segmented
            label={t('cards.createTitle')}
            value={type}
            onChange={setType}
            options={[
              { value: 'VIRTUAL', label: t('cards.virtual') },
              { value: 'SINGLE_USE', label: t('cards.singleUse') },
            ]}
          />
          <Field label={t('cards.label')}>
            <Input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t('cards.linkedWallet')}>
            <WalletSelect wallets={walletsQ.data ?? []} value={walletId} onChange={setWalletId} />
          </Field>
          {type === 'SINGLE_USE' && wallet ? (
            <div className="grid gap-1.5">
              <label htmlFor="card-cap" className="text-sm font-medium">
                {t('cards.cap')} <span className="text-xs text-fg-muted">({t('common.optional')})</span>
              </label>
              <AmountInput id="card-cap" size="md" currency={wallet.currency} value={cap} onValueChange={setCap} />
            </div>
          ) : null}
          {action.error ? <InlineError error={action.error} /> : null}
          <DialogFooter>
            <Button type="submit" loading={action.pending} disabled={!label.trim() || !walletId}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
