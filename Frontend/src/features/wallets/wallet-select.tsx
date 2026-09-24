'use client';

import { useLocale } from 'next-intl';
import { Select } from '@/components/ui/primitives';
import type { Wallet } from '@/lib/api/contracts/phase1';
import { formatMoney } from '@/lib/money';
import { useUiStore } from '@/stores/ui';

/** Wallet picker showing currency and available balance. */
export function WalletSelect({
  wallets,
  value,
  onChange,
  id,
  filter,
  ...aria
}: {
  wallets: Wallet[];
  value?: string;
  onChange: (id: string) => void;
  id?: string;
  filter?: (w: Wallet) => boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const locale = useLocale() === 'ur' ? 'ur' : 'en';
  const hide = useUiStore((s) => s.hideBalances);
  return (
    <Select
      id={id}
      value={value}
      onValueChange={onChange}
      options={wallets
        .filter((w) => (filter ? filter(w) : true))
        .map((w) => ({
          value: w.id,
          disabled: w.status !== 'ACTIVE',
          label: (
            <span className="flex items-center gap-2">
              <span className="font-medium">{w.currency}</span>
              <span className="money text-fg-muted">{hide ? '••••' : formatMoney(w.balance, { locale })}</span>
            </span>
          ),
        }))}
      {...aria}
    />
  );
}
