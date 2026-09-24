'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HandCoins } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
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
import { Avatar, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, InlineError, QueryState } from '@/components/states/states';
import { PinSheet } from '@/components/pin-sheet';
import { invalidateMoney, useQueryClient, useRequests, useWallets } from '@/lib/api/hooks';
import { paymentRequests } from '@/lib/api/services';
import type { PaymentRequest } from '@/lib/api/contracts/phase2';
import { CURRENCIES, type Currency } from '@/lib/api/contracts/common';
import { ApiError, isApiError } from '@/lib/api/errors';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { formatMoney, parseAmountInput } from '@/lib/money';

export default function RequestsPage() {
  const t = useTranslations();
  const [createOpen, setCreateOpen] = React.useState(false);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader
        title={t('nav.requests')}
        description={t('request.subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <HandCoins aria-hidden /> {t('request.title')}
          </Button>
        }
      />
      <Tabs defaultValue="INCOMING">
        <TabsList>
          <TabsTrigger value="INCOMING">{t('request.incoming')}</TabsTrigger>
          <TabsTrigger value="OUTGOING">{t('request.outgoing')}</TabsTrigger>
        </TabsList>
        <TabsContent value="INCOMING" className="mt-4">
          <RequestList direction="INCOMING" />
        </TabsContent>
        <TabsContent value="OUTGOING" className="mt-4">
          <RequestList direction="OUTGOING" />
        </TabsContent>
      </Tabs>
      <CreateRequestDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function RequestList({ direction }: { direction: 'INCOMING' | 'OUTGOING' }) {
  const t = useTranslations();
  const q = useRequests(direction);
  const [paying, setPaying] = React.useState<PaymentRequest | null>(null);
  return (
    <QueryState
      query={q}
      skeleton={<ListSkeleton rows={3} label={t('states.loadingList')} />}
      isEmpty={(d) => d.items.length === 0}
      empty={<EmptyState title={direction === 'INCOMING' ? t('request.noIncoming') : t('request.noOutgoing')} />}
    >
      {(page) => (
        <ul className="grid gap-3">
          {page.items.map((r) => (
            <RequestCard key={r.id} r={r} direction={direction} onPay={() => setPaying(r)} />
          ))}
          <PayRequestSheet request={paying} onClose={() => setPaying(null)} />
        </ul>
      )}
    </QueryState>
  );
}

function RequestCard({
  r,
  direction,
  onPay,
}: {
  r: PaymentRequest;
  direction: 'INCOMING' | 'OUTGOING';
  onPay: () => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const qc = useQueryClient();
  const other = direction === 'INCOMING' ? r.requester : r.payer;
  const act = useMutation({
    mutationFn: () => (direction === 'INCOMING' ? paymentRequests.decline(r.id) : paymentRequests.cancel(r.id)),
    onSuccess: () => {
      toast.success(direction === 'INCOMING' ? t('request.declined') : t('request.cancelled'));
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });
  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <Avatar name={other.displayName} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {direction === 'INCOMING'
                ? t('request.asksYou', { name: other.displayName, amount: formatMoney(r.amount) })
                : t('request.youAsked', { name: other.displayName, amount: formatMoney(r.amount) })}
            </p>
            {r.note ? <p className="text-sm text-fg-muted">“{r.note}”</p> : null}
            <p className="text-xs text-fg-muted">{format.relativeTime(new Date(r.createdAt))}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Amount money={r.amount} size="md" className="font-semibold" />
            <StatusBadge status={r.status} />
          </div>
          {r.status === 'PENDING' ? (
            <div className="flex w-full justify-end gap-2">
              <Button variant="ghost" size="sm" loading={act.isPending} onClick={() => act.mutate()}>
                {direction === 'INCOMING' ? t('request.decline') : t('request.cancelRequest')}
              </Button>
              {direction === 'INCOMING' ? (
                <Button size="sm" onClick={onPay}>
                  {t('request.pay')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {act.error ? <InlineError error={act.error} className="w-full" /> : null}
        </CardContent>
      </Card>
    </li>
  );
}

function PayRequestSheet({ request, onClose }: { request: PaymentRequest | null; onClose: () => void }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const wallet = walletsQ.data?.find((w) => w.currency === request?.amount.currency && w.status === 'ACTIVE');
  const action = useIdempotentAction((pin: string, key: string) =>
    paymentRequests.accept(request!.id, { fromWalletId: wallet!.id, pin }, key),
  );
  const [outerError, setOuterError] = React.useState<unknown>(null);
  const submit = async (pin: string) => {
    try {
      await action.run(pin);
      await invalidateMoney(qc);
      toast.success(t('request.paid'));
      action.reset(); // next request is a new logical action -> new key
      onClose();
    } catch (e) {
      if (!(isApiError(e) && (e.code === 'PIN_INVALID' || e.code === 'PIN_LOCKED'))) setOuterError(e);
    }
  };
  return (
    <PinSheet
      open={Boolean(request)}
      onOpenChange={(o) => {
        if (!o) {
          // Fresh Idempotency-Key for the next request; run() mints one lazily.
          action.reset();
          setOuterError(null);
          onClose();
        }
      }}
      description={
        request
          ? t('pin.subtitle', { amount: formatMoney(request.amount), name: request.requester.displayName })
          : undefined
      }
      summary={
        request ? (
          <div className="grid gap-2 text-sm">
            <Amount money={request.amount} size="lg" />
            {wallet ? null : (
              <InlineError error={new ApiError({ status: 0, code: 'WALLET_NOT_ACTIVE', message: '' })} />
            )}
            {outerError ? <InlineError error={outerError} /> : null}
          </div>
        ) : null
      }
      onSubmit={(pin) => void submit(pin)}
      pending={action.pending}
      retrying={action.status === 'retrying'}
      error={
        action.status === 'error' && isApiError(action.error) && action.error.code.startsWith('PIN')
          ? action.error
          : null
      }
    />
  );
}

function CreateRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [to, setTo] = React.useState('');
  const [currency, setCurrency] = React.useState<Currency>('PKR');
  const [raw, setRaw] = React.useState('');
  const [note, setNote] = React.useState('');
  const [hours, setHours] = React.useState('72');
  const parsed = parseAmountInput(raw, currency);
  const create = useMutation({
    mutationFn: () => {
      const v = to.trim();
      const ref = v.startsWith('+') ? { phone: v.replace(/[\s-]/g, '') } : { username: v.replace(/^@/, '') };
      return paymentRequests.create({
        to: ref,
        currency,
        amount: parsed.ok ? parsed.normalized : '0',
        note: note.trim() || undefined,
        expiresInHours: Number(hours),
      });
    },
    onSuccess: (r) => {
      toast.success(t('request.sent', { name: r.payer.displayName }));
      void qc.invalidateQueries({ queryKey: ['requests'] });
      setTo('');
      setRaw('');
      setNote('');
      onOpenChange(false);
    },
  });
  const currencies = walletsQ.data?.map((w) => w.currency) ?? [...CURRENCIES];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('request.title')}</DialogTitle>
          <DialogDescription>{t('request.subtitle')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (to.trim() && parsed.ok && parsed.minor > 0n) create.mutate();
          }}
        >
          <Field label={t('request.from')}>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('send.searchPlaceholder')}
              dir="ltr"
            />
          </Field>
          <Field label={t('common.currency')}>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as Currency)}
              options={currencies.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <div className="grid gap-1.5">
            <label htmlFor="req-amount" className="text-sm font-medium">
              {t('common.amount')}
            </label>
            <AmountInput id="req-amount" currency={currency} value={raw} onValueChange={setRaw} size="md" />
          </div>
          <Field label={t('common.note')} optional={t('common.optional')}>
            <Input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label={t('request.expires')}>
            <Select
              value={hours}
              onValueChange={setHours}
              options={[
                { value: '24', label: t('request.hours', { count: 24 }) },
                { value: '72', label: t('request.days', { count: 3 }) },
                { value: '168', label: t('request.days', { count: 7 }) },
              ]}
            />
          </Field>
          {create.error ? <InlineError error={create.error} /> : null}
          <DialogFooter>
            <Button type="submit" loading={create.isPending} disabled={!to.trim() || !parsed.ok || parsed.minor <= 0n}>
              {t('request.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
