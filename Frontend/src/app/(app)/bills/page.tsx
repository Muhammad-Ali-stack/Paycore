'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarClock,
  Droplets,
  Flame,
  GraduationCap,
  Landmark,
  Search,
  Smartphone,
  Tv,
  Wifi,
  Zap,
} from 'lucide-react';
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
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field, Input } from '@/components/ui/input';
import { Segmented, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, InlineError, QueryState } from '@/components/states/states';
import { PinSheet } from '@/components/pin-sheet';
import { Receipt } from '@/features/receipt/receipt';
import { WalletSelect } from '@/features/wallets/wallet-select';
import {
  invalidateMoney,
  qk,
  useBillPayments,
  useBillers,
  useQueryClient,
  useSchedules,
  useWallets,
} from '@/lib/api/hooks';
import { bills } from '@/lib/api/services';
import type { Biller, BillerCategory, BillInquiry, BillPayment, BillSchedule } from '@/lib/api/contracts/future';
import { isApiError } from '@/lib/api/errors';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { formatMoney, parseAmountInput } from '@/lib/money';
import { cn } from '@/lib/utils';

const CATEGORY_ICON: Record<BillerCategory, typeof Zap> = {
  ELECTRICITY: Zap,
  GAS: Flame,
  WATER: Droplets,
  INTERNET: Wifi,
  MOBILE: Smartphone,
  TV: Tv,
  EDUCATION: GraduationCap,
  GOVERNMENT: Landmark,
};
const CATEGORIES = ['ALL', 'ELECTRICITY', 'GAS', 'WATER', 'INTERNET', 'MOBILE', 'EDUCATION', 'GOVERNMENT'] as const;

export default function BillsPage() {
  const t = useTranslations();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('bills.title')} description={t('bills.subtitle')} />
      <Tabs defaultValue="pay">
        <TabsList>
          <TabsTrigger value="pay">{t('bills.billers')}</TabsTrigger>
          <TabsTrigger value="scheduled">{t('bills.schedules')}</TabsTrigger>
          <TabsTrigger value="history">{t('bills.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pay" className="mt-5">
          <PayBill />
        </TabsContent>
        <TabsContent value="scheduled" className="mt-5">
          <Schedules />
        </TabsContent>
        <TabsContent value="history" className="mt-5">
          <History />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PayBill() {
  const t = useTranslations();
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>('ALL');
  const [search, setSearch] = React.useState('');
  const [biller, setBiller] = React.useState<Biller | null>(null);
  const billers = useBillers(category === 'ALL' ? undefined : category, search);

  if (biller) return <BillerFlow biller={biller} onBack={() => setBiller(null)} />;

  return (
    <div className="grid gap-4">
      <div
        className="-mx-1 flex scrollbar-none gap-2 overflow-x-auto px-1 pb-1"
        role="radiogroup"
        aria-label={t('bills.billers')}
      >
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'h-9 shrink-0 rounded-full border px-4 text-sm transition-colors',
              category === c
                ? 'border-accent bg-accent-tint text-accent-text'
                : 'border-border text-fg-muted hover:text-fg',
            )}
          >
            {t(`bills.categories.${c}`)}
          </button>
        ))}
      </div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-3.5 size-4 text-fg-muted" aria-hidden />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('bills.searchBillers')}
          aria-label={t('bills.searchBillers')}
          className="ps-9"
        />
      </div>
      <QueryState
        query={billers}
        skeleton={<ListSkeleton rows={4} label={t('states.loadingList')} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('states.emptyTitle')} />}
      >
        {(list) => (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((b) => {
              const Icon = CATEGORY_ICON[b.category];
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setBiller(b)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-4 text-start transition-colors hover:border-accent/40"
                  >
                    <span
                      className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-raised text-accent"
                      aria-hidden
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{b.shortName}</span>
                      <span className="block truncate text-xs text-fg-muted">{b.name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function BillerFlow({ biller, onBack }: { biller: Biller; onBack: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [reference, setReference] = React.useState('');
  const [raw, setRaw] = React.useState('');
  const [picked, setWalletId] = React.useState('');
  const walletId =
    picked || walletsQ.data?.find((x) => x.currency === biller.currency && x.status === 'ACTIVE')?.id || '';
  const [sheet, setSheet] = React.useState(false);
  const [paid, setPaid] = React.useState<BillPayment | null>(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<unknown>(null);
  const refOk = new RegExp(biller.referencePattern).test(reference.replace(/\s+/g, ''));
  const inquiry = useMutation({
    mutationFn: () => bills.inquire({ billerId: biller.id, reference: reference.replace(/\s+/g, '') }),
  });
  const bill: BillInquiry | undefined = inquiry.data;

  const parsed = parseAmountInput(raw, biller.currency);
  const partial = biller.allowsPartialPayment && raw !== '';
  const payMoney = bill
    ? partial && parsed.ok
      ? { currency: biller.currency, amountMinor: parsed.minor.toString(), amount: parsed.normalized }
      : bill.amountDue
    : null;

  const action = useIdempotentAction((pin: string, key: string) =>
    bills.pay(
      {
        inquiryId: bill!.inquiryId,
        fromWalletId: walletId,
        amount: partial && parsed.ok ? parsed.normalized : undefined,
        pin,
      },
      key,
    ),
  );

  const confirm = async (pin: string) => {
    try {
      const p = await action.run(pin);
      await invalidateMoney(qc);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      setSheet(false);
      setPaid(p);
    } catch (e) {
      if (isApiError(e) && (e.code === 'PIN_INVALID' || e.code === 'PIN_LOCKED')) return;
      setSheet(false);
      setNotice(e);
    }
  };

  if (paid) {
    return (
      <Receipt
        status="success"
        title={t('bills.paidTitle')}
        amount={<Amount money={paid.amount} size="xl" />}
        subtitle={t('bills.paidBody', { amount: formatMoney(paid.amount), biller: paid.biller.name })}
        shareText={`${paid.biller.name} · ${paid.reference} · ${formatMoney(paid.amount)} · ${paid.receiptNumber ?? ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setScheduleOpen(true)}>
              <CalendarClock aria-hidden /> {t('bills.schedule')}
            </Button>
            <Button onClick={onBack}>{t('common.done')}</Button>
          </>
        }
      >
        <BillReceiptDetails payment={paid} />
        <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} biller={biller} reference={paid.reference} />
      </Receipt>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <div>
          <CardTitle>{biller.name}</CardTitle>
          <p className="text-xs text-fg-muted">{t(`bills.categories.${biller.category}`)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t('common.back')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (refOk) {
              setNotice(null);
              inquiry.mutate();
            }
          }}
        >
          <Field label={biller.referenceLabel} error={reference && !refOk ? t('validation.required') : undefined}>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" variant="secondary" loading={inquiry.isPending} disabled={!refOk}>
            {t('bills.fetchBill')}
          </Button>
          {inquiry.error ? <InlineError error={inquiry.error} /> : null}
        </form>

        {bill ? (
          <div className="grid gap-5 rounded-lg border border-border bg-raised p-4">
            <DetailList>
              <DetailRow label={t('bills.customer')}>{bill.customerName}</DetailRow>
              <DetailRow label={t('bills.billingMonth')}>{bill.billingMonth}</DetailRow>
              <DetailRow label={t('bills.dueDate')}>
                {format.dateTime(new Date(bill.dueDate), { dateStyle: 'medium' })}
              </DetailRow>
              {bill.amountAfterDue ? (
                <DetailRow label={t('bills.afterDue')}>
                  <Amount money={bill.amountAfterDue} />
                </DetailRow>
              ) : null}
              <DetailRow label={t('bills.amountDue')} emphasis>
                <Amount money={bill.amountDue} size="md" />
              </DetailRow>
            </DetailList>
            {bill.status === 'PAID' ? (
              <p role="status" className="text-sm text-success">
                {t('bills.alreadyPaid')}
              </p>
            ) : (
              <>
                {biller.allowsPartialPayment ? (
                  <div className="grid gap-1.5">
                    <label htmlFor="bill-amount" className="text-sm font-medium">
                      {t('bills.partialAmount')}
                    </label>
                    <AmountInput
                      id="bill-amount"
                      size="md"
                      currency={biller.currency}
                      value={raw}
                      onValueChange={setRaw}
                      placeholder={bill.amountDue.amount}
                    />
                  </div>
                ) : null}
                <Field label={t('scan.payWith')}>
                  <WalletSelect
                    wallets={walletsQ.data ?? []}
                    filter={(w) => w.currency === biller.currency}
                    value={walletId}
                    onChange={setWalletId}
                  />
                </Field>
                {notice ? <InlineError error={notice} /> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={() => setScheduleOpen(true)}>
                    <CalendarClock aria-hidden /> {t('bills.schedule')}
                  </Button>
                  <Button
                    disabled={!walletId || (partial && !parsed.ok)}
                    onClick={() => {
                      action.begin();
                      setNotice(null);
                      setSheet(true);
                    }}
                  >
                    {payMoney ? t('bills.payAmount', { amount: formatMoney(payMoney) }) : t('common.continue')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
        <PinSheet
          open={sheet}
          onOpenChange={(o) => {
            setSheet(o);
            if (!o) action.reset();
          }}
          description={
            payMoney ? t('pin.subtitle', { amount: formatMoney(payMoney), name: biller.shortName }) : undefined
          }
          onSubmit={(pin) => void confirm(pin)}
          pending={action.pending}
          retrying={action.status === 'retrying'}
          error={action.status === 'error' ? action.error : null}
        />
        <ScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          biller={biller}
          reference={reference.replace(/\s+/g, '')}
        />
      </CardContent>
    </Card>
  );
}

function BillReceiptDetails({ payment }: { payment: BillPayment }) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <DetailList>
      <DetailRow label={t('bills.customer')}>{payment.customerName}</DetailRow>
      <DetailRow label={t('common.reference')}>
        <span className="code text-xs">{payment.reference}</span>
      </DetailRow>
      <DetailRow label={t('bills.billingMonth')}>{payment.billingMonth}</DetailRow>
      <DetailRow label={t('bills.receiptNo')}>
        <span className="code text-xs">{payment.receiptNumber ?? '—'}</span>
      </DetailRow>
      <DetailRow label={t('common.status')}>
        <StatusBadge status={payment.status} />
      </DetailRow>
      <DetailRow label={t('common.date')}>
        {format.dateTime(new Date(payment.paidAt ?? payment.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </DetailRow>
      <DetailRow label={t('common.amount')} emphasis>
        <Amount money={payment.amount} />
      </DetailRow>
    </DetailList>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  biller,
  reference,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  biller: Biller;
  reference: string;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [frequency, setFrequency] = React.useState<'ONCE' | 'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [mode, setMode] = React.useState<'FULL_DUE' | 'FIXED'>('FULL_DUE');
  const [raw, setRaw] = React.useState('');
  const [start, setStart] = React.useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [minDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [nickname, setNickname] = React.useState('');
  const [pinOpen, setPinOpen] = React.useState(false);
  const wallet = walletsQ.data?.find((w) => w.currency === biller.currency && w.status === 'ACTIVE');
  const parsed = parseAmountInput(raw, biller.currency);
  const action = useIdempotentAction((pin: string, key: string) =>
    bills.createSchedule(
      {
        billerId: biller.id,
        reference,
        nickname: nickname.trim() || undefined,
        fromWalletId: wallet!.id,
        amountMode: mode,
        fixedAmount: mode === 'FIXED' && parsed.ok ? parsed.normalized : undefined,
        frequency,
        startDate: start,
        pin,
      },
      key,
    ),
  );
  const valid = Boolean(wallet && reference && (mode === 'FULL_DUE' || (parsed.ok && parsed.minor > 0n)));
  const submit = async (pin: string) => {
    try {
      await action.run(pin);
      toast.success(t('bills.scheduled'));
      void qc.invalidateQueries({ queryKey: qk.schedules });
      setPinOpen(false);
      onOpenChange(false);
    } catch {
      /* shown in sheet */
    }
  };
  return (
    <>
      <Dialog open={open && !pinOpen} onOpenChange={onOpenChange}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('bills.scheduleTitle')}</DialogTitle>
            <DialogDescription>
              {biller.shortName} · <span className="code">{reference}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label={t('bills.frequency')}>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as typeof frequency)}
                options={(['ONCE', 'WEEKLY', 'MONTHLY'] as const).map((f) => ({ value: f, label: t(`bills.${f}`) }))}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('bills.amountMode')}</span>
              <Segmented
                label={t('bills.amountMode')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'FULL_DUE', label: t('bills.FULL_DUE') },
                  { value: 'FIXED', label: t('bills.FIXED') },
                ]}
              />
            </div>
            {mode === 'FIXED' ? (
              <AmountInput
                size="md"
                currency={biller.currency}
                value={raw}
                onValueChange={setRaw}
                aria-label={t('bills.fixedAmount')}
              />
            ) : null}
            <Field label={t('bills.startDate')}>
              <Input type="date" value={start} min={minDate} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t('bills.nickname')} optional={t('common.optional')}>
              <Input value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button
              disabled={!valid}
              onClick={() => {
                action.begin();
                setPinOpen(true);
              }}
            >
              {t('common.continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PinSheet
        open={pinOpen}
        onOpenChange={(o) => {
          setPinOpen(o);
          if (!o) action.reset();
        }}
        title={t('bills.scheduleTitle')}
        onSubmit={(pin) => void submit(pin)}
        pending={action.pending}
        error={action.status === 'error' ? action.error : null}
      />
    </>
  );
}

function Schedules() {
  const t = useTranslations();
  const format = useFormatter();
  const qc = useQueryClient();
  const q = useSchedules();
  const toggle = useMutation({
    mutationFn: (s: BillSchedule) =>
      bills.updateSchedule(s.id, { status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: qk.schedules });
      const prev = qc.getQueryData<BillSchedule[]>(qk.schedules);
      qc.setQueryData<BillSchedule[]>(qk.schedules, (old) =>
        old?.map((x) => (x.id === s.id ? { ...x, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : x)),
      );
      return { prev };
    },
    onError: (_e, _s, ctx) => ctx?.prev && qc.setQueryData(qk.schedules, ctx.prev),
    onSuccess: (s) => toast.success(s.status === 'PAUSED' ? t('bills.paused') : t('bills.resumed')),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.schedules }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => bills.deleteSchedule(id),
    onSuccess: () => {
      toast.success(t('bills.deleted'));
      void qc.invalidateQueries({ queryKey: qk.schedules });
    },
  });
  return (
    <QueryState
      query={q}
      skeleton={<ListSkeleton rows={2} label={t('states.loadingList')} />}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title={t('bills.noSchedules')} body={t('bills.noSchedulesBody')} />}
    >
      {(list) => (
        <ul className="grid gap-3">
          {list.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4 pt-5">
                  <CalendarClock className="size-5 text-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.nickname ?? s.biller.name}</p>
                    <p className="text-xs text-fg-muted">
                      {t(`bills.${s.frequency}`)} · {s.fixedAmount ? formatMoney(s.fixedAmount) : t('bills.FULL_DUE')}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {s.nextRunAt
                        ? t('bills.nextRun', { date: format.dateTime(new Date(s.nextRunAt), { dateStyle: 'medium' }) })
                        : null}
                      {s.lastRun
                        ? ` · ${t('bills.lastRun', { date: format.dateTime(new Date(s.lastRun.at), { dateStyle: 'medium' }) })}`
                        : null}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">{s.status === 'ACTIVE' ? t('bills.pause') : t('bills.resume')}</span>
                    <Switch checked={s.status === 'ACTIVE'} onCheckedChange={() => toggle.mutate(s)} />
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(s.id)}
                    loading={remove.isPending && remove.variables === s.id}
                  >
                    {t('common.remove')}
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

function History() {
  const t = useTranslations();
  const format = useFormatter();
  const q = useBillPayments();
  const [open, setOpen] = React.useState<BillPayment | null>(null);
  return (
    <>
      <QueryState
        query={q}
        skeleton={<Skeleton className="h-60 rounded-lg" />}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={t('bills.noHistory')} />}
      >
        {(page) => (
          <Card>
            <CardContent className="pt-4">
              <ul className="divide-y divide-border/60">
                {page.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(p)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-start hover:bg-raised"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.biller.name}</span>
                        <span className="block text-xs text-fg-muted">
                          {p.billingMonth} · {format.dateTime(new Date(p.createdAt), { dateStyle: 'medium' })}
                        </span>
                      </span>
                      <Amount money={p.amount} direction="OUT" />
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </QueryState>
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('bills.receipt')}</DialogTitle>
            <DialogDescription>{open?.biller.name}</DialogDescription>
          </DialogHeader>
          {open ? <BillReceiptDetails payment={open} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
