'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/primitives';
import type { KycMe } from '@/lib/api/contracts/phase1';
import type { Currency } from '@/lib/api/contracts/common';

const ORDER = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;

export function tierIndex(tier: string) {
  return Math.max(0, ORDER.indexOf(tier as (typeof ORDER)[number]));
}

/** KYC tier progress with the current daily limit; links to the upgrade flow. */
export function KycBanner({ kyc, currency }: { kyc: KycMe; currency: Currency }) {
  const t = useTranslations();
  const idx = tierIndex(kyc.tier);
  const next = ORDER[idx + 1];
  const pending = kyc.submissions.some((s) => s.status === 'PENDING');
  const limit = kyc.limits.find((l) => l.currency === currency && l.permitted) ?? kyc.limits.find((l) => l.permitted);
  return (
    <section
      aria-labelledby="kyc-banner-title"
      className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
      data-testid="kyc-banner"
    >
      <IsoBlocks count={4} filled={idx + 1} className="h-16 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h2 id="kyc-banner-title" className="text-sm font-semibold">
            {t('home.kycTitle', { tier: t(`kyc.tiers.${kyc.tier}`) })}
          </h2>
          <p className="text-xs text-fg-muted">
            {pending
              ? t('home.kycPending')
              : next
                ? t('home.kycBody', { next: t(`kyc.tiers.${next}`) })
                : t('home.kycMax')}
          </p>
        </div>
        <Progress value={((idx + 1) / ORDER.length) * 100} label={t('kyc.currentTier')} />
        {limit ? (
          <p className="text-xs text-fg-muted">
            {t.rich('home.dailyLimit', { amount: () => <Amount money={limit.daily} size="xs" className="text-fg" /> })}
          </p>
        ) : null}
      </div>
      {next && !pending ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/profile/kyc">{t('home.upgrade')}</Link>
        </Button>
      ) : null}
    </section>
  );
}
