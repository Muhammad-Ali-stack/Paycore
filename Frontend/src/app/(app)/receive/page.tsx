'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { AmountInput } from '@/components/money/amount-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/input';
import { Select, Switch } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, QueryState } from '@/components/states/states';
import { QrCode } from '@/features/qr/qr-code';
import { useMe, useWallets } from '@/lib/api/hooks';
import { qr } from '@/lib/api/services';
import type { Currency } from '@/lib/api/contracts/common';
import { parseAmountInput } from '@/lib/money';

export default function ReceivePage() {
  const t = useTranslations();
  const format = useFormatter();
  const walletsQ = useWallets();
  const me = useMe();
  const [picked, setCurrency] = React.useState<Currency | ''>('');
  const [withAmount, setWithAmount] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  const [applied, setApplied] = React.useState<string | undefined>(undefined);
  const currency: Currency | '' = picked || walletsQ.data?.[0]?.currency || '';

  const code = useQuery({
    queryKey: ['my-qr', currency, applied ?? ''],
    queryFn: () => qr.receive({ currency: currency as Currency, amount: applied }),
    enabled: Boolean(currency),
    staleTime: Infinity,
  });
  const parsed = currency ? parseAmountInput(raw, currency) : null;

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader title={t('receive.title')} description={t('receive.subtitle')} />
      <QueryState query={walletsQ} skeleton={<Skeleton className="h-96 rounded-lg" />}>
        {(wallets) => (
          <Card>
            <CardContent className="grid gap-6 pt-5">
              <div className="flex flex-col items-center gap-3">
                {code.isPending ? (
                  <Skeleton className="size-[260px] rounded-lg" />
                ) : code.isError ? (
                  <ErrorState compact error={code.error} onRetry={() => void code.refetch()} />
                ) : (
                  <>
                    <QrCode payload={code.data.payload} size={260} label={t('receive.qrAlt', { currency })} />
                    <p className="text-sm font-medium">{me.data?.fullName}</p>
                    {me.data?.username ? <p className="text-xs text-fg-muted">@{me.data.username}</p> : null}
                    <p className="text-xs text-fg-muted">
                      {code.data.expiresAt
                        ? t('receive.validFor', {
                            time: format.dateTime(new Date(code.data.expiresAt), { timeStyle: 'short' }),
                          })
                        : t('receive.openAmount')}
                    </p>
                    <div className="flex gap-2">
                      <CopyButton value={code.data.payload} label={t('receive.copyCode')} />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (navigator.share)
                            void navigator.share({ title: 'PayCore', text: code.data.payload }).catch(() => undefined);
                        }}
                      >
                        <Share2 aria-hidden /> {t('receive.shareCode')}
                      </Button>
                    </div>
                    <p className="sr-only" data-testid="my-qr-payload">
                      {code.data.payload}
                    </p>
                  </>
                )}
              </div>
              <Field label={t('receive.currency')}>
                <Select
                  value={currency || undefined}
                  onValueChange={(v) => {
                    setCurrency(v as Currency);
                    setApplied(undefined);
                    setRaw('');
                  }}
                  options={wallets.map((w) => ({ value: w.currency, label: w.currency }))}
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="with-amount" className="text-sm font-medium">
                  {t('receive.fixedAmount')}
                </label>
                <Switch
                  id="with-amount"
                  checked={withAmount}
                  onCheckedChange={(v) => {
                    setWithAmount(v);
                    if (!v) setApplied(undefined);
                  }}
                />
              </div>
              {withAmount && currency ? (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (parsed?.ok && parsed.minor > 0n) setApplied(parsed.normalized);
                  }}
                >
                  <AmountInput
                    currency={currency}
                    value={raw}
                    onValueChange={setRaw}
                    size="md"
                    aria-label={t('common.amount')}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!parsed?.ok || parsed.minor <= 0n}
                    loading={code.isFetching}
                  >
                    {t('receive.generate')}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
