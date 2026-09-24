'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, InlineError } from '@/components/states/states';
import { useMerchantPayments } from '@/lib/api/hooks';
import type { MerchantPayment } from '@/lib/api/contracts/phase2';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { PaymentsTable } from '@/features/merchant/payment-list';
import { PaymentDrawer } from '@/features/merchant/payment-drawer';
import { useDebounced } from '@/features/merchant/hooks';

const STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'REVERSED'] as const;

export default function MerchantPaymentsPage() {
  return <MerchantGate>{() => <Payments />}</MerchantGate>;
}

function Payments() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const tStatus = useTranslations('status');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('ALL');
  const q = useDebounced(search.trim(), 300);
  const query = useMerchantPayments({ q: q || undefined, status: status === 'ALL' ? undefined : status });
  const [open, setOpen] = React.useState<MerchantPayment | null>(null);
  const items = React.useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const filtered = Boolean(q) || status !== 'ALL';

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  const sentinel = React.useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <PageHeader title={t('paymentsTitle')} description={t('paymentsDescription')} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPayments')}
            aria-label={t('searchPayments')}
            className="ps-9"
            data-testid="merchant-payments-search"
          />
        </div>
        <Select
          value={status}
          onValueChange={setStatus}
          aria-label={t('filterStatus')}
          className="sm:w-56"
          options={[
            { value: 'ALL', label: t('allStatuses') },
            ...STATUSES.map((s) => ({ value: s, label: tStatus(s) })),
          ]}
        />
      </div>

      <Card>
        <CardContent className="pt-2 sm:pt-3">
          {query.isPending ? (
            <ListSkeleton rows={8} label={tc('loading')} />
          ) : query.isError && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} className="my-3" />
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState title={t('noMatches')} body={t('noMatchesBody')} />
            ) : (
              <EmptyState title={t('noPayments')} body={t('noPaymentsBody')} />
            )
          ) : (
            <>
              <PaymentsTable items={items} onOpen={setOpen} />
              <div ref={sentinel} aria-hidden className="h-px" />
              <div className="flex justify-center pt-4" aria-live="polite">
                {query.hasNextPage ? (
                  <Button
                    variant="secondary"
                    onClick={() => void query.fetchNextPage()}
                    loading={query.isFetchingNextPage}
                  >
                    {tc('loadMore')}
                  </Button>
                ) : (
                  <p className="text-xs text-fg-muted">{ts('endOfList')}</p>
                )}
              </div>
              {query.isFetchNextPageError ? <InlineError error={query.error} className="mt-3" /> : null}
            </>
          )}
        </CardContent>
      </Card>
      <PaymentDrawer payment={open} onClose={() => setOpen(null)} />
    </>
  );
}
