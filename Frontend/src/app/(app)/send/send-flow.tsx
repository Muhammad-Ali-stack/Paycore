'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Timer } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field, Input } from '@/components/ui/input';
import { Avatar, Segmented, Select } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineError, QueryState } from '@/components/states/states';
import { PinSheet } from '@/components/pin-sheet';
import { Receipt } from '@/features/receipt/receipt';
import { WalletSelect } from '@/features/wallets/wallet-select';
import { RecipientPicker, type RecipientRef } from './recipient-picker';
import { invalidateMoney, useQueryClient, useWallets } from '@/lib/api/hooks';
import { transfers } from '@/lib/api/services';
import type { AmountSide, Payment, UserLookup } from '@/lib/api/contracts/phase2';
import type { Currency } from '@/lib/api/contracts/common';
import { ApiError, isApiError } from '@/lib/api/errors';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { useCountdown } from '@/hooks/use-countdown';
import { compareMinor, formatMoney, formatRate, parseAmountInput } from '@/lib/money';
import { shortId } from '@/lib/utils';

type Step = 'recipient' | 'amount' | 'done';

export function SendFlow() {
  const t = useTranslations();
  const params = useSearchParams();
  const [step, setStep] = React.useState<Step>('recipient');
  const [recipient, setRecipient] = React.useState<{ user: UserLookup; ref: RecipientRef } | null>(null);
  const [payment, setPayment] = React.useState<Payment | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);

  const reset = () => {
    setStep('recipient');
    setRecipient(null);
    setPayment(null);
    setFailure(null);
  };

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader title={t('send.title')} />
      <ol className="flex items-center gap-2 text-xs text-fg-muted" aria-label={t('send.title')}>
        {(['recipient', 'amount', 'done'] as const).map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={step === s ? 'step' : undefined}>
            <span
              className={
                step === s
                  ? 'inline-flex size-6 items-center justify-center rounded-full bg-accent text-accent-fg'
                  : 'inline-flex size-6 items-center justify-center rounded-full border border-border'
              }
            >
              {i + 1}
            </span>
            <span className={step === s ? 'text-fg' : undefined}>
              {s === 'recipient'
                ? t('send.recipientStep')
                : s === 'amount'
                  ? t('send.amountStep')
                  : t('send.reviewStep')}
            </span>
            {i < 2 ? <span aria-hidden className="h-px w-6 bg-border" /> : null}
          </li>
        ))}
      </ol>

      {step === 'recipient' ? (
        <Card>
          <CardContent className="pt-5">
            <RecipientPicker
              initialQuery={params.get('to') ?? undefined}
              onPick={(user, ref) => {
                setRecipient({ user, ref });
                setStep('amount');
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 'amount' && recipient ? (
        <AmountStep
          recipient={recipient.user}
          recipientRef={recipient.ref}
          onChangeRecipient={() => setStep('recipient')}
          onDone={(p) => {
            setPayment(p);
            setStep('done');
          }}
          onFail={(e) => {
            setFailure(e);
            setStep('done');
          }}
        />
      ) : null}

      {step === 'done' ? (
        payment ? (
          <SuccessReceipt payment={payment} onAgain={reset} />
        ) : (
          <Receipt
            status="failure"
            title={t('send.failedTitle')}
            error={failure}
            actions={<Button onClick={reset}>{t('send.sendAnother')}</Button>}
          />
        )
      ) : null}
    </div>
  );
}

function SuccessReceipt({ payment, onAgain }: { payment: Payment; onAgain: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const amountText = formatMoney(payment.amount);
  return (
    <Receipt
      status="success"
      title={t('send.successTitle')}
      amount={<Amount money={payment.amount} size="xl" />}
      subtitle={t('send.successBody', { amount: amountText, name: payment.payee.displayName })}
      shareText={t('send.shareText', {
        amount: amountText,
        name: payment.payee.displayName,
        date: format.dateTime(new Date(payment.createdAt), { dateStyle: 'medium' }),
        ref: shortId(payment.id),
      })}
      actions={
        <>
          <Button variant="secondary" onClick={onAgain}>
            {t('send.sendAnother')}
          </Button>
          <Button asChild>
            <Link href="/home">{t('common.done')}</Link>
          </Button>
        </>
      }
    >
      <DetailList>
        <DetailRow label={t('send.recipient')}>{payment.payee.displayName}</DetailRow>
        {payment.received && payment.received.currency !== payment.amount.currency ? (
          <DetailRow label={t('send.theyGet')}>
            <Amount money={payment.received} />
          </DetailRow>
        ) : null}
        <DetailRow label={t('common.fee')}>
          {compareMinor(payment.fee.amountMinor, 0n) === 0 ? t('common.free') : <Amount money={payment.fee} />}
        </DetailRow>
        <DetailRow label={t('send.totalDebit')} emphasis>
          <Amount money={payment.totalDebit} />
        </DetailRow>
        {payment.reference ? <DetailRow label={t('common.note')}>{payment.reference}</DetailRow> : null}
        <DetailRow label={t('send.paymentId')}>
          <span className="code text-xs" data-testid="payment-id">
            {shortId(payment.id)}
          </span>
        </DetailRow>
        <DetailRow label={t('common.date')}>
          {format.dateTime(new Date(payment.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </DetailRow>
      </DetailList>
    </Receipt>
  );
}

function AmountStep({
  recipient,
  recipientRef,
  onChangeRecipient,
  onDone,
  onFail,
}: {
  recipient: UserLookup;
  recipientRef: RecipientRef;
  onChangeRecipient: () => void;
  onDone: (p: Payment) => void;
  onFail: (e: unknown) => void;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [pickedFrom, setFromId] = React.useState<string>('');
  const [pickedTo, setToCurrency] = React.useState<Currency | ''>('');
  const [side, setSide] = React.useState<AmountSide>('SEND');
  const [raw, setRaw] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [note, setNote] = React.useState('');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<unknown>(null);

  // Defaults are derived (not synced via effects): a wallet the recipient can receive in, same currency if possible.
  const defaultFrom =
    walletsQ.data?.find((w) => w.status === 'ACTIVE' && recipient.wallets.includes(w.currency)) ??
    walletsQ.data?.find((w) => w.status === 'ACTIVE');
  const fromId = pickedFrom || defaultFrom?.id || '';
  const from = walletsQ.data?.find((w) => w.id === fromId);
  const toCurrency: Currency | '' =
    pickedTo ||
    (from ? (recipient.wallets.includes(from.currency) ? from.currency : (recipient.wallets[0] ?? from.currency)) : '');

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(raw), 350);
    return () => window.clearTimeout(id);
  }, [raw]);

  const amountCurrency = side === 'SEND' ? from?.currency : toCurrency || undefined;
  const parsed = amountCurrency ? parseAmountInput(debounced, amountCurrency) : null;
  const rawParsed = amountCurrency ? parseAmountInput(raw, amountCurrency) : null;
  const valid = Boolean(parsed?.ok && parsed.minor > 0n && from && toCurrency);

  const quote = useQuery({
    queryKey: ['transfer-quote', fromId, recipient.userId, toCurrency, side, parsed?.ok ? parsed.normalized : ''],
    queryFn: () =>
      transfers.quote({
        fromWalletId: fromId,
        to: recipientRef,
        toCurrency: toCurrency as Currency,
        amount: parsed && parsed.ok ? parsed.normalized : '0',
        amountSide: side,
      }),
    enabled: valid,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    // Refresh exactly when the quote expires, but never under an open PIN sheet.
    refetchInterval: (q) => {
      const exp = q.state.data?.expiresAt;
      if (!exp || sheetOpen) return false;
      return Math.max(1000, Date.parse(exp) - Date.now());
    },
  });
  const secondsLeft = useCountdown(quote.data?.expiresAt);

  const action = useIdempotentAction((pin: string, key: string) =>
    transfers.execute({ quoteId: quote.data!.id, pin, note: note.trim() || undefined }, key),
  );

  const openSheet = () => {
    action.begin();
    setNotice(null);
    setSheetOpen(true);
  };

  const confirm = async (pin: string) => {
    try {
      const p = await action.run(pin);
      await invalidateMoney(qc);
      setSheetOpen(false);
      onDone(p);
    } catch (e) {
      if (isApiError(e) && (e.code === 'PIN_INVALID' || e.code === 'PIN_LOCKED')) return; // shown in the sheet
      setSheetOpen(false);
      if (isApiError(e) && e.code === 'QUOTE_EXPIRED') {
        setNotice(e);
        void quote.refetch();
        return;
      }
      if (
        isApiError(e) &&
        ['INSUFFICIENT_FUNDS', 'LIMIT_EXCEEDED', 'CURRENCY_NOT_PERMITTED', 'VALIDATION_FAILED'].includes(e.code)
      ) {
        setNotice(e);
        return;
      }
      onFail(e);
    }
  };

  const overBalance =
    from && quote.data ? compareMinor(quote.data.totalDebit.amountMinor, from.balance.amountMinor) > 0 : false;

  return (
    <QueryState query={walletsQ} skeleton={<Skeleton className="h-96 rounded-lg" />}>
      {(wallets) => (
        <Card>
          <CardContent className="grid gap-5 pt-5">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-raised p-3">
              <Avatar name={recipient.displayName} tone="gold" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" data-testid="recipient-name">
                  {recipient.displayName}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {recipient.username ? `@${recipient.username} · ` : ''}
                  <bdi className="code">{recipient.phoneMasked}</bdi>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={onChangeRecipient}>
                {t('send.change')}
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('send.fromWallet')}>
                <WalletSelect
                  wallets={wallets}
                  value={fromId}
                  onChange={(id) => {
                    setFromId(id);
                    action.reset();
                  }}
                />
              </Field>
              <Field label={t('send.theyReceive')}>
                <Select
                  value={toCurrency || undefined}
                  onValueChange={(v) => setToCurrency(v as Currency)}
                  options={recipient.wallets.map((c) => ({ value: c, label: c }))}
                />
              </Field>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="send-amount" className="text-sm font-medium">
                  {t('common.amount')}
                </label>
                {from && toCurrency && from.currency !== toCurrency ? (
                  <Segmented
                    label={t('common.amount')}
                    value={side}
                    onChange={(v) => {
                      setSide(v);
                      setRaw('');
                    }}
                    options={[
                      { value: 'SEND', label: t('send.youSend') },
                      { value: 'RECEIVE', label: t('send.theyGet') },
                    ]}
                  />
                ) : null}
              </div>
              <AmountInput
                id="send-amount"
                currency={amountCurrency ?? 'PKR'}
                value={raw}
                onValueChange={setRaw}
                aria-invalid={rawParsed && !rawParsed.ok && raw ? true : undefined}
                data-testid="amount-input"
              />
            </div>

            <Field label={t('send.noteLabel')} optional={t('common.optional')}>
              <Input
                value={note}
                maxLength={140}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('send.notePlaceholder')}
              />
            </Field>

            <section
              aria-live="polite"
              aria-label={t('send.review')}
              className="rounded-lg border border-border bg-bg/40 p-4"
              data-testid="quote-panel"
            >
              {!valid ? (
                <p className="text-sm text-fg-muted">{t('send.enterAmount')}</p>
              ) : quote.isPending || (quote.isFetching && !quote.data) ? (
                <div className="grid gap-2" role="status">
                  <span className="sr-only">{t('send.quoteRefreshing')}</span>
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : quote.isError ? (
                <InlineError error={quote.error} />
              ) : quote.data ? (
                <DetailList>
                  <DetailRow label={t('send.youSend')}>
                    <Amount money={quote.data.send} />
                  </DetailRow>
                  <DetailRow label={t('send.fxFee')}>
                    {compareMinor(quote.data.fee.amountMinor, 0n) === 0 ? (
                      t('common.free')
                    ) : (
                      <Amount money={quote.data.fee} />
                    )}
                  </DetailRow>
                  {quote.data.fx ? (
                    <DetailRow label={t('send.rate')}>
                      <span className="money" data-testid="fx-rate">
                        1 {quote.data.send.currency} = {formatRate(quote.data.fx.customerRate)}{' '}
                        {quote.data.receive.currency}
                      </span>
                      <span className="block text-xs text-fg-muted">
                        {t('send.midRate', { rate: formatRate(quote.data.fx.midRate) })}
                      </span>
                    </DetailRow>
                  ) : (
                    <DetailRow label={t('send.rate')}>{t('send.sameCurrency')}</DetailRow>
                  )}
                  <DetailRow label={t('send.theyGet')}>
                    <Amount money={quote.data.receive} className="text-accent-text" />
                  </DetailRow>
                  <DetailRow label={t('send.totalDebit')} emphasis>
                    <Amount money={quote.data.totalDebit} />
                  </DetailRow>
                </DetailList>
              ) : null}
              {valid && quote.data && !quote.isError ? (
                <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1" data-testid="quote-countdown">
                    <Timer className="size-3.5" aria-hidden />
                    {secondsLeft > 0 ? t('send.quoteExpiresIn', { s: secondsLeft }) : t('send.quoteExpired')}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void quote.refetch()} loading={quote.isFetching}>
                    <RefreshCw aria-hidden /> {t('send.refreshQuote')}
                  </Button>
                </div>
              ) : null}
            </section>

            {overBalance ? (
              <InlineError error={new ApiError({ status: 0, code: 'INSUFFICIENT_FUNDS', message: '' })} />
            ) : null}
            {notice ? <InlineError error={notice} /> : null}

            <Button
              size="lg"
              block
              disabled={!quote.data || secondsLeft <= 0 || overBalance || quote.isFetching}
              onClick={openSheet}
              data-testid="send-review"
            >
              {quote.data ? t('send.sendNow', { amount: formatMoney(quote.data.totalDebit) }) : t('send.review')}
            </Button>

            <PinSheet
              open={sheetOpen}
              onOpenChange={(o) => {
                setSheetOpen(o);
                if (!o) action.reset();
              }}
              description={
                quote.data
                  ? t('pin.subtitle', { amount: formatMoney(quote.data.totalDebit), name: recipient.displayName })
                  : undefined
              }
              summary={
                quote.data ? (
                  <DetailList>
                    <DetailRow label={t('send.recipient')}>{recipient.displayName}</DetailRow>
                    <DetailRow label={t('send.theyGet')}>
                      <Amount money={quote.data.receive} />
                    </DetailRow>
                    <DetailRow label={t('send.totalDebit')} emphasis>
                      <Amount money={quote.data.totalDebit} />
                    </DetailRow>
                  </DetailList>
                ) : null
              }
              onSubmit={(pin) => void confirm(pin)}
              pending={action.pending}
              retrying={action.status === 'retrying'}
              error={action.status === 'error' ? action.error : null}
            />
          </CardContent>
        </Card>
      )}
    </QueryState>
  );
}
