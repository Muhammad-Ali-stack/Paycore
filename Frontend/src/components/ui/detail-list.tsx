import * as React from 'react';
import { cn } from '@/lib/utils';

/** Label/value rows for receipts, previews and detail drawers. */
export function DetailList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <dl className={cn('grid gap-3 text-sm', className)}>{children}</dl>;
}

export function DetailRow({
  label,
  children,
  emphasis,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', emphasis && 'border-t border-border pt-3', className)}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn('min-w-0 text-end text-fg', emphasis && 'font-semibold')}>{children}</dd>
    </div>
  );
}
