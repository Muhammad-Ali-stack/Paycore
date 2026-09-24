'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Plus, Snowflake } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import type { Wallet } from '@/lib/api/contracts/phase1';
import { cn } from '@/lib/utils';

const FLAG: Record<string, string> = { PKR: 'Pakistani rupee', AED: 'UAE dirham', USD: 'US dollar' };

export function BalanceCard({ wallet, active, className }: { wallet: Wallet; active?: boolean; className?: string }) {
  const t = useTranslations('home');
  return (
    <div
      className={cn(
        'balance-surface relative flex h-44 flex-col justify-between overflow-hidden rounded-xl border p-5 shadow-card transition-colors',
        active ? 'border-accent/40' : 'border-border',
        className,
      )}
      data-testid={`wallet-card-${wallet.currency}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">
            {FLAG[wallet.currency] ?? wallet.currency}
          </p>
          <p className="text-sm font-semibold text-fg">{wallet.currency}</p>
        </div>
        {wallet.status !== 'ACTIVE' ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-tint px-2 py-0.5 text-xs text-warning">
            <Snowflake className="size-3" aria-hidden /> {t('frozen')}
          </span>
        ) : null}
      </div>
      <div>
        <p className="text-xs text-fg-muted">{t('available')}</p>
        <Amount money={wallet.balance} size="xl" hideable className="text-fg" />
      </div>
      {/* Isometric hairline motif (decorative) */}
      <svg aria-hidden viewBox="0 0 120 80" className="pointer-events-none absolute -end-4 -bottom-6 h-28 opacity-40">
        <path d="M10 50 60 75 110 50 60 25Z" fill="none" stroke="var(--pc-accent)" strokeWidth="0.8" />
        <path d="M20 38 60 58 100 38 60 18Z" fill="none" stroke="var(--pc-fg-subtle)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

/** Horizontal, snap-scrolling wallet switcher with keyboard/prev-next controls. */
export function BalanceCarousel({
  wallets,
  index,
  onIndexChange,
  onAddWallet,
}: {
  wallets: Wallet[];
  index: number;
  onIndexChange: (i: number) => void;
  onAddWallet?: () => void;
}) {
  const t = useTranslations('home');
  const scroller = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const scrollTo = (i: number) => {
    const el = scroller.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
    onIndexChange(i);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    const i = Math.round(Math.abs(el.scrollLeft) / (w + 12));
    if (i !== index && i < wallets.length) onIndexChange(i);
  };

  return (
    <section aria-roledescription="carousel" aria-label={t('wallets')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('wallets')}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('previousWallet')}
            disabled={index === 0}
            onClick={() => scrollTo(index - 1)}
          >
            <ChevronLeft className="rtl:rotate-180" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('nextWallet')}
            disabled={index >= wallets.length - 1}
            onClick={() => scrollTo(index + 1)}
          >
            <ChevronRight className="rtl:rotate-180" aria-hidden />
          </Button>
          {onAddWallet ? (
            <Button variant="ghost" size="sm" onClick={onAddWallet}>
              <Plus aria-hidden /> {t('addWallet')}
            </Button>
          ) : null}
        </div>
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory scrollbar-none gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {wallets.map((w, i) => (
          <motion.div
            key={w.id}
            role="group"
            aria-roledescription="slide"
            aria-label={t('walletOf', { n: i + 1, total: wallets.length })}
            className="w-[82%] shrink-0 snap-start sm:w-[calc(50%-6px)] xl:w-[calc(33.333%-8px)]"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.05 }}
          >
            <button
              type="button"
              className="block w-full rounded-xl text-start"
              onClick={() => onIndexChange(i)}
              aria-pressed={i === index}
            >
              <BalanceCard wallet={w} active={i === index} />
            </button>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {wallets.map((w, i) => (
          <span
            key={w.id}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index ? 'w-5 bg-accent' : 'w-1.5 bg-border-strong',
            )}
          />
        ))}
      </div>
    </section>
  );
}
