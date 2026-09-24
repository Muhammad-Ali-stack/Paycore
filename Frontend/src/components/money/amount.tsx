'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMinor, type FormatMoneyOptions } from '@/lib/money';
import type { Money } from '@/lib/api/contracts/common';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

const sizes = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-semibold',
  xl: 'text-3xl font-semibold tracking-tight',
  hero: 'text-4xl font-semibold tracking-tight sm:text-5xl',
};

/**
 * The only way money is rendered in the UI. Always formats from amountMinor,
 * tabular figures, isolated direction (so "Rs 1,250.00" never flips in RTL).
 */
export function Amount({
  money,
  size = 'sm',
  signed,
  direction,
  hideable,
  className,
  display,
  trimZeroFraction,
}: {
  money: Pick<Money, 'amountMinor' | 'currency'>;
  size?: keyof typeof sizes;
  /** Adds +/−. With `direction`, the sign follows IN/OUT. */
  signed?: boolean;
  direction?: 'IN' | 'OUT';
  /** Respects the "hide balances" privacy toggle. */
  hideable?: boolean;
  className?: string;
  display?: FormatMoneyOptions['display'];
  trimZeroFraction?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations('common');
  const hidden = useUiStore((s) => s.hideBalances) && hideable;
  let minor = money.amountMinor;
  if (direction === 'OUT' && !minor.startsWith('-')) minor = `-${minor}`;
  const text = formatMinor(minor, money.currency, {
    locale: locale === 'ur' ? 'ur' : 'en',
    signed: signed || direction === 'IN',
    display,
    trimZeroFraction,
  });
  if (hidden) {
    return (
      <span className={cn('money', sizes[size], className)}>
        <span aria-hidden>••••••</span>
        <span className="sr-only">{t('hidden')}</span>
      </span>
    );
  }
  return (
    <span className={cn('money', sizes[size], direction === 'IN' && 'text-success', className)}>
      {text.replace('-', '−')}
    </span>
  );
}
