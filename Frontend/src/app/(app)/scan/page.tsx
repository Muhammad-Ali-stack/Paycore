'use client';

import * as React from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { QrCode as QrIcon, Store, User } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field } from '@/components/ui/input';
import { InlineError } from '@/components/states/states';
import { Spinner } from '@/components/ui/spinner';
import { PinSheet } from '@/components/pin-sheet';
import { QrScanner } from '@/features/qr/qr-scanner';
import { Receipt } from '@/features/receipt/receipt';
import { WalletSelect } from '@/features/wallets/wallet-select';
import { invalidateMoney, useQueryClient, useWallets } from '@/lib/api/hooks';
import { qr } from '@/lib/api/services';
import type { Payment, QrPreview } from '@/lib/api/contracts/phase2';
import { isApiError } from '@/lib/api/errors';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { useCountdown } from '@/hooks/use-countdown';
import { formatMoney, parseAmountInput } from '@/lib/money';
import { shortId } from '@/lib/utils';

export default function ScanPage() {
  const t = useTranslations();
  const [preview, setPreview] = React.useState<QrPreview | null>(null);
  const [payment, setPayment] = React.useState<Payment | null>(null);
  const resolve = useMutation({ mutationFn: (payload: string) => qr.resolve(payload), onSuccess: setPreview });

  const restart = () => {
    setPreview(null);
    setPayment(null);
    resolve.reset();
  };

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader
        title={t('scan.title')}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/receive">
              <QrIcon aria-hidden /> {t('scan.myQr')}
            </Link>
          </Button>
        }
      />
      {payment ? (
        <PaidReceipt payment={payment} onAgain={restart} />
      ) : preview ? (
        <PreviewStep preview={preview} onCancel={restart} onPaid={setPayment} />
      ) : (
        <Card>
          <CardContent className="grid gap-4 pt-5">
            <QrScanner onResult={(p) => resolve.mutate(p)} disabled={resolve.isPending} />
            {resolve.isPending ? (
              <p role="status" className="flex items-center justify-center gap-2 text-sm text-fg-muted">
                <Spinner className="size-4" /> {t('scan.resolving')}
              </p>
            ) : null}
            {resolve.error ? <InlineError error={resolve.error} /> : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreviewStep({
  preview,
  onCancel,
  onPaid,
}: {
  preview: QrPreview;
  onCancel: () => void;
  onPaid: (p: Payment) => void;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const eligible = walletsQ.data?.filter((w) => w.currency === preview.currency && w.status === 'ACTIVE') ?? [];
  const [picked, setWalletId] = React.useState('');
  const walletId = picked || eligible[0]?.id || '';
  const [raw, setRaw] = React.useState('');
  const [sheet, setSheet] = React.useState(false);
  const [notice, setNotice] = React.useState<unknown>(null);
  const previewLeft = useCountdown(preview.previewExpiresAt);

  const parsed = parseAmountInput(raw, preview.currency);
  const amountOk = preview.amount !== null || (parsed.ok && parsed.minor > 0n);
  const amountMoney =
    preview.amount ??
    (parsed.ok
      ? { currency: preview.currency, amountMinor: parsed.minor.toString(), amount: parsed.normalized }
      : null);

  const action = useIdempotentAction((pin: string, key: string) =>
    qr.pay(
      {
        previewToken: preview.previewToken,
        fromWalletId: walletId,
        amount: preview.amount === null && parsed.ok ? parsed.normalized : undefined,
        pin,
      },
      key,
    ),
  );

  const confirm = async (pin: string) => {
    try {
      const p = await action.run(pin);
      await invalidateMoney(qc);
      setSheet(false);
      onPaid(p);
    } catch (e) {
      if (isApiError(e) && (e.code === 'PIN_INVALID' || e.code === 'PIN_LOCKED')) return;
      setSheet(false);
      setNotice(e);
    }
  };

  const PayeeIcon = preview.payee.type === 'MERCHANT' ? Store : User;
  const terminal = isApiError(notice) && ['QR_EXPIRED', 'QR_ALREADY_PAID', 'QR_INVALID'].includes(notice.code);

  return (
    <Card data-testid="qr-preview">
      <CardContent className="grid gap-5 pt-5">
        <h2 className="text-lg font-semibold">{t('scan.previewTitle')}</h2>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-raised p-4">
          <span className="inline-flex size-11 items-center justify-center rounded-full border border-accent/30 bg-accent-tint text-accent">
            <PayeeIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">{t('scan.payTo')}</p>
            <p className="truncate font-semibold" data-testid="qr-payee">
              {preview.payee.displayName}
            </p>
            {preview.payee.outletName ? (
              <p className="truncate text-xs text-fg-muted">{preview.payee.outletName}</p>
            ) : null}
          </div>
        </div>

        {preview.amount ? (
          <div className="text-center">
            <p className="text-xs text-fg-muted">{t('scan.fixedAmount')}</p>
            <Amount money={preview.amount} size="xl" />
          </div>
        ) : (
          <div className="grid gap-2">
            <label htmlFor="qr-amount" className="text-sm font-medium">
              {t('scan.enterAmount')}
            </label>
            <AmountInput
              id="qr-amount"
              currency={preview.currency}
              value={raw}
              onValueChange={setRaw}
              autoFocus
              data-testid="qr-amount"
            />
          </div>
        )}

        {eligible.length ? (
          <Field label={t('scan.payWith')}>
            <WalletSelect
              wallets={walletsQ.data ?? []}
              filter={(w) => w.currency === preview.currency}
              value={walletId}
              onChange={setWalletId}
            />
          </Field>
        ) : walletsQ.data ? (
          <p
            role="alert"
            className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning"
          >
            {t('scan.noWallet', { currency: preview.currency })}
          </p>
        ) : null}

        <DetailList>
          <DetailRow label={t('common.fee')}>
            {preview.fee && preview.fee.amountMinor !== '0' ? <Amount money={preview.fee} /> : t('common.free')}
          </DetailRow>
          {amountMoney ? (
            <DetailRow label={t('common.total')} emphasis>
              <Amount money={amountMoney} />
            </DetailRow>
          ) : null}
        </DetailList>
        <p className="text-xs text-fg-muted" aria-live="polite">
          {previewLeft > 0 ? t('scan.previewExpires', { s: previewLeft }) : t('common.expired')}
        </p>

        {notice ? <InlineError error={notice} /> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel}>
            {terminal ? t('scan.scanAnother') : t('common.cancel')}
          </Button>
          <Button
            size="lg"
            disabled={!amountOk || !walletId || previewLeft <= 0 || terminal}
            onClick={() => {
              action.begin();
              setNotice(null);
              setSheet(true);
            }}
            data-testid="qr-pay"
          >
            {amountMoney ? t('scan.pay', { amount: formatMoney(amountMoney) }) : t('common.continue')}
          </Button>
        </div>

        <PinSheet
          open={sheet}
          onOpenChange={(o) => {
            setSheet(o);
            if (!o) action.reset();
          }}
          description={
            amountMoney
              ? t('pin.subtitle', { amount: formatMoney(amountMoney), name: preview.payee.displayName })
              : undefined
          }
          onSubmit={(pin) => void confirm(pin)}
          pending={action.pending}
          retrying={action.status === 'retrying'}
          error={action.status === 'error' ? action.error : null}
        />
      </CardContent>
    </Card>
  );
}

function PaidReceipt({ payment, onAgain }: { payment: Payment; onAgain: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const amount = formatMoney(payment.amount);
  return (
    <Receipt
      status="success"
      title={t('scan.successTitle')}
      amount={<Amount money={payment.amount} size="xl" />}
      subtitle={t('scan.successBody', { amount, name: payment.payee.displayName })}
      shareText={t('send.shareText', {
        amount,
        name: payment.payee.displayName,
        date: format.dateTime(new Date(payment.createdAt), { dateStyle: 'medium' }),
        ref: shortId(payment.id),
      })}
      actions={
        <>
          <Button variant="secondary" onClick={onAgain}>
            {t('scan.scanAnother')}
          </Button>
          <Button asChild>
            <Link href="/home">{t('common.done')}</Link>
          </Button>
        </>
      }
    >
      <DetailList>
        <DetailRow label={t('scan.payTo')}>{payment.payee.displayName}</DetailRow>
        {payment.payee.outletName ? <DetailRow label={t('scan.outlet')}>{payment.payee.outletName}</DetailRow> : null}
        {payment.reference ? <DetailRow label={t('common.reference')}>{payment.reference}</DetailRow> : null}
        <DetailRow label={t('send.paymentId')}>
          <span className="code text-xs">{shortId(payment.id)}</span>
        </DetailRow>
        <DetailRow label={t('common.date')}>
          {format.dateTime(new Date(payment.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </DetailRow>
      </DetailList>
    </Receipt>
  );
}
