'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/primitives';
import { SkeletonGroup } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, InlineError } from '@/components/states/states';
import { useAudit } from '@/lib/api/hooks';
import { AuditSkeletonRows, AuditTable } from '@/features/admin/audit';
import { useDebounced } from '@/features/admin/shared';

const ALL = '__ALL__';

export default function AdminAuditPage() {
  const t = useTranslations();
  const [text, setText] = React.useState('');
  const [action, setAction] = React.useState<string>(ALL);
  const q = useDebounced(text.trim(), 350);
  const query = useAudit({ q: q || undefined, action: action === ALL ? undefined : action });
  const events = React.useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  // Build the action filter from every action seen so far, so filtering doesn't shrink the list.
  // (State adjusted during render, React's "storing information from previous renders" pattern.)
  const [seen, setSeen] = React.useState<string[]>([]);
  if (events.some((e) => !seen.includes(e.action))) {
    setSeen([...new Set([...seen, ...events.map((e) => e.action)])].sort());
  }

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const sentinel = React.useRef<HTMLDivElement>(null);
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

  const options = [{ value: ALL, label: t('admin.audit.allActions') }, ...seen.map((a) => ({ value: a, label: a }))];

  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.auditTitle')} description={t('admin.audit.subtitle')} />

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('common.search')} className="w-full sm:w-80">
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('admin.audit.searchPlaceholder')}
            autoComplete="off"
          />
        </Field>
        <Field label={t('admin.action')} className="w-full sm:w-72">
          <Select value={action} onValueChange={setAction} options={options} />
        </Field>
        {text || action !== ALL ? (
          <Button
            variant="ghost"
            onClick={() => {
              setText('');
              setAction(ALL);
            }}
          >
            {t('common.clear')}
          </Button>
        ) : null}
      </div>

      <Card className="p-3">
        {query.isPending ? (
          <SkeletonGroup label={t('states.loadingList')}>
            <AuditSkeletonRows rows={8} />
          </SkeletonGroup>
        ) : query.isError && !events.length ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : events.length === 0 ? (
          <EmptyState
            title={t('admin.audit.emptyTitle')}
            body={q || action !== ALL ? t('admin.audit.emptyFiltered') : undefined}
          />
        ) : (
          <>
            <p className="sr-only" aria-live="polite">
              {t('admin.resultsCount', { count: events.length })}
            </p>
            <AuditTable events={events} />
            <div ref={sentinel} aria-hidden className="h-px" />
            <div className="mt-4 flex flex-col items-center gap-2" aria-live="polite">
              {query.isFetchNextPageError ? <InlineError error={query.error} /> : null}
              {hasNextPage ? (
                <Button variant="secondary" size="sm" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                  {t('common.loadMore')}
                </Button>
              ) : (
                <p className="text-xs text-fg-muted">{t('states.endOfList')}</p>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
