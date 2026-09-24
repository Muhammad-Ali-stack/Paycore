'use client';

/**
 * Admin-portal helpers shared by the admin pages. Kept local to the admin feature
 * so nothing outside src/features/admin needs to change.
 */
import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useErrorMessage } from '@/components/states/states';
import { isApiError } from '@/lib/api/errors';
import { cn, maskMiddle } from '@/lib/utils';

/* ------------------------------- Formatting ------------------------------ */

/** Basis points to a percent string with string/integer math only: 150 -> "1.50%". */
export function bpsToPercent(bps: number): string {
  const v = Math.trunc(bps);
  const neg = v < 0;
  const abs = Math.abs(v);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
}

export function useDateTime() {
  const format = useFormatter();
  return React.useCallback(
    (iso: string | null | undefined, style: 'datetime' | 'date' = 'datetime') => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return style === 'date'
        ? format.dateTime(d, { dateStyle: 'medium' })
        : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });
    },
    [format],
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return v;
}

/* --------------------------------- Errors -------------------------------- */

/** Like useErrorMessage, plus admin-only codes (maker-checker) that core messages lack. */
export function useAdminErrorMessage() {
  const base = useErrorMessage();
  const t = useTranslations('admin.errors');
  return React.useCallback(
    (e: unknown) => {
      if (isApiError(e)) {
        if (e.code === 'SELF_APPROVAL_FORBIDDEN') return t('selfApproval');
        if (e.code === 'APPROVAL_NOT_PENDING') return t('notPending');
      }
      return base(e);
    },
    [base, t],
  );
}

export function AdminInlineError({ error, className }: { error: unknown; className?: string }) {
  const message = useAdminErrorMessage();
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
      <span>{message(error)}</span>
    </p>
  );
}

/* ---------------------------------- PII ---------------------------------- */

/**
 * Masked PII with an explicit reveal toggle. Reveal state is local to this element
 * and never persisted or logged.
 */
export function Masked({
  value,
  start = 4,
  end = 2,
  label,
  className,
}: {
  value: string;
  start?: number;
  end?: number;
  /** What the value is, for the toggle's accessible name, e.g. "Phone". */
  label: string;
  className?: string;
}) {
  const t = useTranslations('admin');
  const [shown, setShown] = React.useState(false);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="code" dir="ltr">
        {shown ? value : maskMiddle(value, start, end)}
      </span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? t('hideValue', { label }) : t('revealValue', { label })}
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        {shown ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
      </button>
    </span>
  );
}

/* ------------------------------ Small badges ----------------------------- */

export function RiskBadge({ score }: { score: number | null }) {
  const t = useTranslations('admin');
  if (score === null) return <span className="text-fg-muted">–</span>;
  const tone = score >= 70 ? 'danger' : score >= 40 ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} aria-label={t('riskScoreValue', { score })}>
      <span className="money">{score}</span>
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const t = useTranslations('status');
  const tone =
    severity === 'CRITICAL' ? 'danger' : severity === 'HIGH' ? 'warning' : severity === 'MEDIUM' ? 'accent' : 'neutral';
  const key = severity as Parameters<typeof t>[0];
  return (
    <Badge tone={tone} dot>
      {t.has(key) ? t(key) : severity}
    </Badge>
  );
}

/* ------------------------------ Note dialog ------------------------------ */

/**
 * A confirm dialog with a note/reason textarea (optional or with a minimum length).
 * `onSubmit` performs the mutation; errors render inline, success closes the dialog.
 */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  minLength = 0,
  confirmLabel,
  tone = 'primary',
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  label: React.ReactNode;
  placeholder?: string;
  /** 0 = optional note. */
  minLength?: number;
  confirmLabel: React.ReactNode;
  tone?: 'primary' | 'danger';
  onSubmit: (note: string) => Promise<unknown>;
  /** Extra read-only context rendered above the field. */
  children?: React.ReactNode;
}) {
  const t = useTranslations();
  const schema = React.useMemo(
    () =>
      z.object({
        note:
          minLength > 0 ? z.string().trim().min(minLength, 'min').max(1000, 'max') : z.string().trim().max(1000, 'max'),
      }),
    [minLength],
  );
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { note: '' } });
  const mutation = useMutation({ mutationFn: (note: string) => onSubmit(note) });

  React.useEffect(() => {
    if (!open) {
      form.reset({ note: '' });
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const err = form.formState.errors.note;
  const errorText = err
    ? err.message === 'max'
      ? t('admin.form.maxChars', { max: 1000 })
      : t('admin.form.minChars', { min: minLength })
    : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t('common.close')} {...(description ? {} : { 'aria-describedby': undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await mutation.mutateAsync(v.note.trim());
              onOpenChange(false);
            } catch {
              /* shown inline */
            }
          })}
        >
          {children}
          <Field
            label={label}
            error={errorText}
            optional={minLength > 0 ? undefined : t('common.optional')}
            hint={minLength > 0 ? t('admin.form.minChars', { min: minLength }) : undefined}
          >
            <Textarea placeholder={placeholder} rows={3} {...form.register('note')} />
          </Field>
          <div aria-live="polite">
            <AdminInlineError error={mutation.error} />
          </div>
          <DialogFooter className="mt-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={mutation.isPending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Simple yes/no confirmation that runs a mutation. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: React.ReactNode;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown>;
}) {
  const t = useTranslations('common');
  const mutation = useMutation({ mutationFn: onConfirm });
  React.useEffect(() => {
    if (!open) mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div aria-live="polite">
          <AdminInlineError error={mutation.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={mutation.isPending}
            onClick={async () => {
              try {
                await mutation.mutateAsync();
                onOpenChange(false);
              } catch {
                /* shown inline */
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Layout -------------------------------- */

export function SectionHeading({ id, children, count }: { id: string; children: React.ReactNode; count?: number }) {
  return (
    <h2 id={id} className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
      {children}
      {count !== undefined ? <Badge tone="neutral">{count}</Badge> : null}
    </h2>
  );
}

/** Table head cell: consistent style + scope. */
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-2 text-start text-xs font-medium tracking-wider text-fg-muted uppercase', className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-3 align-top text-sm text-fg', className)}>{children}</td>;
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'code max-h-64 overflow-auto rounded-md border border-border bg-bg p-3 text-xs leading-relaxed text-fg',
        className,
      )}
      dir="ltr"
    >
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}
