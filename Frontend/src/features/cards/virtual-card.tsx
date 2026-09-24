'use client';

import { useTranslations } from 'next-intl';
import { Snowflake } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import type { Card, CardSecrets } from '@/lib/api/contracts/future';
import { cn } from '@/lib/utils';

function groupPan(pan: string) {
  return pan.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Slate + gold card visual. Secrets render only while revealed. */
export function VirtualCard({
  card,
  secrets,
  selected,
  className,
}: {
  card: Card;
  secrets?: CardSecrets | null;
  selected?: boolean;
  className?: string;
}) {
  const t = useTranslations('cards');
  const mm = String(secrets?.expiryMonth ?? card.expiryMonth).padStart(2, '0');
  const yy = String(secrets?.expiryYear ?? card.expiryYear).slice(-2);
  return (
    <div
      dir="ltr"
      className={cn(
        'card-surface relative aspect-[1.586] w-full overflow-hidden rounded-xl border p-5 text-[var(--pc-card-fg)] shadow-card',
        selected ? 'border-accent/60' : 'border-border-strong',
        card.status === 'FROZEN' && 'saturate-0',
        className,
      )}
      data-testid={`virtual-card-${card.last4}`}
    >
      {/* gold hairlines */}
      <svg
        aria-hidden
        viewBox="0 0 200 126"
        className="pointer-events-none absolute inset-0 size-full"
        preserveAspectRatio="none"
      >
        <path
          d="M120 126 200 70M140 126 200 88M160 126 200 104"
          stroke="var(--pc-card-line)"
          strokeWidth="0.6"
          fill="none"
        />
      </svg>
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <LogoMark title={null} className="size-7" />
            <span className="text-sm font-medium">{card.label}</span>
          </div>
          <span className="text-xs font-semibold tracking-widest text-accent">
            {card.type === 'SINGLE_USE' ? '1×' : ''} {card.currency}
          </span>
        </div>
        <div aria-live="polite">
          <p className="code text-lg tracking-[0.18em] sm:text-xl" data-testid="card-pan">
            {secrets ? groupPan(secrets.pan) : `•••• •••• •••• ${card.last4}`}
          </p>
        </div>
        <div className="flex items-end justify-between gap-3 text-xs">
          <div>
            <p className="text-[10px] tracking-wider uppercase opacity-70">{t('cardholder')}</p>
            <p className="font-medium">{card.cardholderName}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-wider uppercase opacity-70">{t('expiry')}</p>
            <p className="code">
              {mm}/{yy}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wider uppercase opacity-70">{t('cvv')}</p>
            <p className="code" data-testid="card-cvv">
              {secrets ? secrets.cvv : '•••'}
            </p>
          </div>
          <p className="text-base font-bold tracking-wide italic">{card.brand}</p>
        </div>
      </div>
      {card.status === 'FROZEN' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/40">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-1 text-xs font-medium text-fg">
            <Snowflake className="size-3.5" aria-hidden /> {t('status.FROZEN')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
