'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineError, QueryState } from '@/components/states/states';
import { PinSheet } from '@/components/pin-sheet';
import { WalletSelect } from '@/features/wallets/wallet-select';
import { FundingHistory } from '@/features/funding/funding-history';
import { invalidateMoney, useQueryClient, useWallets } from '@/lib/api/hooks';
import { funding } from '@/lib/api/services';
import { withdrawSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { isApiError } from '@/lib/api/errors';
import { formatMoney, moneyFromMinor, parseAmountInput } from '@/lib/money';
import type { Currency } from '@/lib/api/contracts/common';

const WITHDRAW_FEE: Record<Currency, bigint> = { PKR: 2500n, AED: 100n, USD: 25n };

export default function WithdrawPage() {
  const t = useTranslations();
  const fe = useFieldError();
  const router = useRouter();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [picked, setWalletId] = React.useState('');
  const walletId = picked || walletsQ.data?.[0]?.id || '';
  const wallet = walletsQ.data?.find((w) => w.id === walletId);
  const currency = wallet?.currency ?? 'PKR';
  const schema = React.useMemo(
    () => withdrawSchema(currency, wallet ? BigInt(wallet.balance.amountMinor) - WITHDRAW_FEE[currency] : undefined),
    [currency, wallet],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', iban: '', accountTitle: '', bankName: '' },
  });
  const [sheet, setSheet] = React.useState(false);
  const [values, setValues] = React.useState<Values | null>(null);
  const [notice, setNotice] = React.useState<unknown>(null);

  const parsed = values ? parseAmountInput(values.amount, currency) : null;
  const amount = parsed?.ok ? moneyFromMinor(parsed.minor, currency) : null;

  const action = useIdempotentAction((pin: string, key: string) =>
    funding.withdraw(
      {
        walletId,
        amount: parsed && parsed.ok ? parsed.normalized : '0',
        bankAccount: {
          iban: values!.iban.replace(/\s+/g, '').toUpperCase(),
          accountTitle: values!.accountTitle.trim(),
          bankName: values!.bankName.trim(),
        },
        pin,
      },
      key,
    ),
  );

  const confirm = async (pin: string) => {
    try {
      const f = await action.run(pin);
      await invalidateMoney(qc);
      void qc.invalidateQueries({ queryKey: ['funding'] });
      setSheet(false);
      router.push(`/funding/${f.id}`);
    } catch (e) {
      if (isApiError(e) && (e.code === 'PIN_INVALID' || e.code === 'PIN_LOCKED')) return;
      setSheet(false);
      setNotice(e);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader
        title={t('funding.withdrawTitle')}
        description={t('funding.withdrawSubtitle')}
        back={{ href: '/topup', label: t('funding.topupTitle') }}
      />
      <QueryState query={walletsQ} skeleton={<Skeleton className="h-96 rounded-lg" />}>
        {(wallets) => (
          <Card>
            <CardContent className="pt-5">
              <form
                noValidate
                className="grid gap-5"
                onSubmit={form.handleSubmit((v) => {
                  setValues(v);
                  setNotice(null);
                  action.begin();
                  setSheet(true);
                })}
              >
                <Field label={t('funding.fromWallet')}>
                  <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
                </Field>
                <div className="grid gap-1.5">
                  <label htmlFor="wd-amount" className="text-sm font-medium">
                    {t('common.amount')}
                  </label>
                  <Controller
                    control={form.control}
                    name="amount"
                    render={({ field, fieldState }) => (
                      <AmountInput
                        id="wd-amount"
                        currency={currency}
                        value={field.value}
                        onValueChange={field.onChange}
                        aria-invalid={fieldState.error ? true : undefined}
                        aria-describedby={fieldState.error ? 'wd-amount-error' : undefined}
                      />
                    )}
                  />
                  {form.formState.errors.amount ? (
                    <p id="wd-amount-error" role="alert" className="text-xs text-danger">
                      {fe(form.formState.errors.amount)}
                    </p>
                  ) : null}
                  <p className="text-xs text-fg-muted">
                    {t('common.fee')}: {formatMoney(moneyFromMinor(WITHDRAW_FEE[currency], currency))}
                  </p>
                </div>
                <fieldset className="grid gap-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">{t('funding.bankAccount')}</legend>
                  <Field label={t('funding.iban')} error={fe(form.formState.errors.iban)}>
                    <Input
                      dir="ltr"
                      autoComplete="off"
                      placeholder="PK36MEZN0000001234567890"
                      {...form.register('iban')}
                    />
                  </Field>
                  <Field label={t('funding.accountTitle')} error={fe(form.formState.errors.accountTitle)}>
                    <Input autoComplete="name" {...form.register('accountTitle')} />
                  </Field>
                  <Field label={t('funding.bankName')} error={fe(form.formState.errors.bankName)}>
                    <Input {...form.register('bankName')} />
                  </Field>
                </fieldset>
                {notice ? <InlineError error={notice} /> : null}
                <Button type="submit" size="lg" block>
                  {t('common.continue')}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </QueryState>
      <FundingHistory />
      <PinSheet
        open={sheet}
        onOpenChange={(o) => {
          setSheet(o);
          if (!o) action.reset();
        }}
        description={amount ? t('funding.startWithdraw', { amount: formatMoney(amount) }) : undefined}
        summary={
          amount && values ? (
            <DetailList>
              <DetailRow label={t('common.amount')}>
                <Amount money={amount} />
              </DetailRow>
              <DetailRow label={t('common.fee')}>
                <Amount money={moneyFromMinor(WITHDRAW_FEE[currency], currency)} />
              </DetailRow>
              <DetailRow label={t('funding.iban')}>
                <span className="code text-xs">
                  {values.iban
                    .replace(/\s+/g, '')
                    .toUpperCase()
                    .replace(/^(.{4}).*(.{4})$/, '$1 •••• $2')}
                </span>
              </DetailRow>
            </DetailList>
          ) : null
        }
        onSubmit={(pin) => void confirm(pin)}
        pending={action.pending}
        retrying={action.status === 'retrying'}
        error={action.status === 'error' ? action.error : null}
      />
    </div>
  );
}
