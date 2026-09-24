'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react';
import { IsoBlocks } from '@/components/brand/iso-blocks';
import { Button } from '@/components/ui/button';
import { errorMessageKey, isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { useOnline } from '@/hooks/use-online';

export function EmptyState({
  title,
  body,
  action,
  className,
  compact,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'gap-2 py-6' : 'gap-3 py-12', className)}>
      <IsoBlocks count={compact ? 2 : 3} className={compact ? 'h-12' : 'h-20'} />
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {body ? <p className="max-w-sm text-sm text-fg-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Translated, user-safe message for any thrown error. */
export function useErrorMessage() {
  const t = useTranslations();
  return React.useCallback(
    (e: unknown): string => {
      if (isApiError(e)) {
        if (e.code === 'PIN_INVALID' && e.attemptsRemaining !== undefined) {
          return t('errors.PIN_ATTEMPTS', { count: e.attemptsRemaining });
        }
        if (e.code === 'LIMIT_EXCEEDED' && e.isRecipientLimit) return t('errors.LIMIT_RECIPIENT');
        if (e.code === 'LIMIT_EXCEEDED' && e.limitKind) {
          return t(`errors.LIMIT_${e.limitKind}`);
        }
      }
      return t(errorMessageKey(e) as 'errors.GENERIC');
    },
    [t],
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations();
  const message = useErrorMessage()(error);
  const cid = isApiError(error) ? error.correlationId : undefined;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger-tint text-center',
        compact ? 'p-4' : 'p-8',
        className,
      )}
    >
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{t('states.errorTitle')}</p>
        <p className="text-sm text-fg-muted">{message}</p>
        {cid ? <p className="code text-xs text-fg-muted">{t('common.correlation', { id: cid })}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Inline, non-blocking error text for forms and sheets. */
export function InlineError({ error, className }: { error: unknown; className?: string }) {
  const message = useErrorMessage()(error);
  if (!error) return null;
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

/**
 * Standard query rendering: skeleton while loading, error with retry, empty state,
 * then content. Every data screen uses this for full state coverage.
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  skeleton: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (empty && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function OfflineBanner() {
  const online = useOnline();
  const t = useTranslations('states');
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-warning/30 bg-warning-tint px-4 py-2 text-center text-xs font-medium text-warning"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {t('offline')}
    </div>
  );
}
