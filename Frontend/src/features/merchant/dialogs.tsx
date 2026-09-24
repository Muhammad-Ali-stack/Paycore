'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InlineError } from '@/components/states/states';

/** Destructive confirmation with inline error and a loading confirm button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
}) {
  const t = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error ? <InlineError error={error} /> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows a secret exactly once, with copy and a warning. */
export function SecretOnce({
  label,
  secret,
  warning,
  onDone,
}: {
  label: string;
  secret: string;
  warning: string;
  onDone: () => void;
}) {
  const t = useTranslations('merchant');
  return (
    <div className="grid gap-4">
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning"
      >
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{warning}</span>
      </p>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        <div className="flex items-center gap-2 rounded-md border border-border bg-raised p-2">
          <code dir="ltr" className="code min-w-0 flex-1 text-xs break-all text-fg" data-testid="secret-once-value">
            {secret}
          </code>
          <CopyButton value={secret} />
        </div>
      </div>
      <DialogFooter className="mt-0">
        <Button onClick={onDone}>{t('savedIt')}</Button>
      </DialogFooter>
    </div>
  );
}
