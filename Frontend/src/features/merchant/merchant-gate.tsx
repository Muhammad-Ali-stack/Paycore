'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states/states';
import { useMerchant } from '@/lib/api/hooks';
import type { Merchant } from '@/lib/api/contracts/phase2';
import { isNotFound } from './hooks';

export function OnboardingCta() {
  const t = useTranslations('merchant');
  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full border border-accent/30 bg-accent-tint text-accent">
        <Store className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('onboardingTitle')}</h1>
        <p className="text-sm text-fg-muted">{t('onboardingBody')}</p>
      </div>
      <Button asChild size="lg">
        <Link href="/merchant/onboarding">{t('startOnboarding')}</Link>
      </Button>
    </Card>
  );
}

export function StatusBanner({ merchant }: { merchant: Merchant }) {
  const t = useTranslations('merchant');
  if (merchant.status === 'ACTIVE') return null;
  const suspended = merchant.status === 'SUSPENDED';
  return (
    <div
      role="status"
      className={
        suspended
          ? 'flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger-text'
          : 'flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning'
      }
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{suspended ? t('suspended') : t('pendingReview')}</span>
    </div>
  );
}

/**
 * Loads the merchant profile. No profile yet (404) shows the onboarding CTA;
 * anything else renders children with the merchant.
 */
export function MerchantGate({
  children,
  banner = false,
}: {
  children: (merchant: Merchant) => React.ReactNode;
  banner?: boolean;
}) {
  const t = useTranslations('common');
  const q = useMerchant();
  if (q.isPending) {
    return (
      <SkeletonGroup label={t('loading')} className="grid gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </SkeletonGroup>
    );
  }
  if (q.isError) {
    if (isNotFound(q.error)) return <OnboardingCta />;
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  return (
    <div className="grid gap-6">
      {banner ? <StatusBanner merchant={q.data} /> : null}
      {children(q.data)}
    </div>
  );
}
