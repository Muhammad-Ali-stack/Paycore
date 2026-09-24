'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowUpFromLine, Building2, CreditCard } from 'lucide-react';
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
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineError, QueryState } from '@/components/states/states';
import { WalletSelect } from '@/features/wallets/wallet-select';
import { FundingHistory } from '@/features/funding/funding-history';
import { useQueryClient, useWallets } from '@/lib/api/hooks';
import { funding } from '@/lib/api/services';
import type { FundingMethod } from '@/lib/api/contracts/phase2';
import { useIdempotentAction } from '@/hooks/use-idempotent-action';
import { formatMoney, moneyFromMinor, parseAmountInput } from '@/lib/money';
import { cn } from '@/lib/utils';

/** Card top-ups carry a 1.5% fee (from GET /fees in production; mirrored here for the preview). */
const CARD_FEE_BPS = 150n;

export default function TopupPage() {
  const t = useTranslations();
  const router = useRouter();
  const qc = useQueryClient();
  const walletsQ = useWallets();
  const [picked, setWalletId] = React.useState('');
  const [method, setMethod] = React.useState<FundingMethod>('BANK_TRANSFER');
  const [raw, setRaw] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const walletId = picked || walletsQ.data?.[0]?.id || '';
  const wallet = walletsQ.data?.find((w) => w.id === walletId);

  const parsed = wallet ? parseAmountInput(raw, wallet.currency) : null;
  const valid = Boolean(parsed?.ok && parsed.minor > 0n);
  const amount = wallet && parsed?.ok ? moneyFromMinor(parsed.minor, wallet.currency) : null;
  const fee =
    amount && method === 'CARD'
      ? moneyFromMinor((BigInt(amount.amountMinor) * CARD_FEE_BPS + 5000n) / 10000n, amount.currency)
      : null;

  const action = useIdempotentAction((_: void, key: string) =>
    funding.topup({ walletId, amount: parsed && parsed.ok ? parsed.normalized : '0', method }, key),
  );

  const submit = async () => {
    try {
      const f = await action.run();
      void qc.invalidateQueries({ queryKey: ['funding'] });
      router.push(`/funding/${f.id}`);
    } catch {
      /* shown inline */
    }
  };

  const methods: { value: FundingMethod; label: string; hint: string; icon: typeof Building2 }[] = [
    { value: 'BANK_TRANSFER', label: t('funding.bankTransfer'), hint: t('funding.bankTransferHint'), icon: Building2 },
    { value: 'CARD', label: t('funding.card'), hint: t('funding.cardHint'), icon: CreditCard },
  ];

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PageHeader
        title={t('funding.topupTitle')}
        description={t('funding.topupSubtitle')}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/withdraw">
              <ArrowUpFromLine aria-hidden /> {t('nav.withdraw')}
            </Link>
          </Button>
        }
      />
      <QueryState query={walletsQ} skeleton={<Skeleton className="h-80 rounded-lg" />}>
        {(wallets) => (
          <Card>
            <CardContent className="grid gap-5 pt-5">
              <Field label={t('funding.toWallet')}>
                <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
              </Field>
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-medium">{t('funding.method')}</legend>
                <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                  {methods.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={method === m.value}
                      onClick={() => setMethod(m.value)}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-4 text-start transition-colors',
                        method === m.value
                          ? 'border-accent bg-accent-tint'
                          : 'border-border bg-raised hover:border-border-strong',
                      )}
                    >
                      <m.icon
                        className={cn('mt-0.5 size-5', method === m.value ? 'text-accent' : 'text-fg-muted')}
                        aria-hidden
                      />
                      <span>
                        <span className="block text-sm font-medium">{m.label}</span>
                        <span className="block text-xs text-fg-muted">{m.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2">
                <label htmlFor="topup-amount" className="text-sm font-medium">
                  {t('common.amount')}
                </label>
                <AmountInput
                  id="topup-amount"
                  currency={wallet?.currency ?? 'PKR'}
                  value={raw}
                  onValueChange={setRaw}
                  data-testid="topup-amount"
                />
              </div>
              <Button
                size="lg"
                block
                disabled={!valid}
                onClick={() => {
                  action.begin();
                  setConfirmOpen(true);
                }}
                data-testid="topup-continue"
              >
                {amount ? t('funding.startTopup', { amount: formatMoney(amount) }) : t('common.continue')}
              </Button>
            </CardContent>
          </Card>
        )}
      </QueryState>

      <FundingHistory />

      <Dialog open={confirmOpen} onOpenChange={(o) => !action.pending && setConfirmOpen(o)}>
        <DialogContent closeLabel={t('common.close')} hideClose={action.pending}>
          <DialogHeader>
            <DialogTitle>{t('funding.topupTitle')}</DialogTitle>
            <DialogDescription>{method === 'CARD' ? t('funding.card') : t('funding.bankTransfer')}</DialogDescription>
          </DialogHeader>
          {amount ? (
            <DetailList>
              <DetailRow label={t('common.amount')}>
                <Amount money={amount} />
              </DetailRow>
              <DetailRow label={t('common.fee')}>{fee ? <Amount money={fee} /> : t('common.free')}</DetailRow>
              <DetailRow label={t('funding.toWallet')}>{wallet?.currency}</DetailRow>
            </DetailList>
          ) : null}
          {action.error ? <InlineError error={action.error} className="mt-4" /> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={action.pending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={action.pending} data-testid="topup-confirm">
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
