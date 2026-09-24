import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-raised text-fg-muted',
        accent: 'border-accent/30 bg-accent-tint text-accent-text',
        success: 'border-success/30 bg-success-tint text-success',
        danger: 'border-danger/30 bg-danger-tint text-danger-text',
        warning: 'border-warning/30 bg-warning-tint text-warning',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {props.children}
    </span>
  );
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Maps any backend status string to a tone. */
export function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (
    [
      'COMPLETED',
      'SUCCEEDED',
      'ACTIVE',
      'PAID',
      'APPROVED',
      'SETTLED',
      'ACCEPTED',
      'ENABLED',
      'CLOSED_LEGIT',
      'SUCCESS',
    ].includes(s)
  )
    return 'success';
  if (
    [
      'FAILED',
      'DECLINED',
      'REJECTED',
      'SUSPENDED',
      'FROZEN',
      'CLOSED_FRAUD',
      'CRITICAL',
      'DENIED',
      'TERMINATED',
      'REVERSED',
    ].includes(s)
  )
    return 'danger';
  if (
    [
      'PENDING',
      'PROCESSING',
      'CREATED',
      'AUTHORIZED',
      'PENDING_REVIEW',
      'INVESTIGATING',
      'ESCALATED',
      'HIGH',
      'PARTIALLY_REFUNDED',
      'OPEN',
      'PAUSED',
    ].includes(s)
  )
    return 'warning';
  if (['REFUNDED', 'EXPIRED', 'CANCELLED', 'DISABLED', 'USED', 'MEDIUM', 'LOW'].includes(s)) return 'neutral';
  return 'neutral';
}
