'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { LockKeyhole } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { InlineError } from '@/components/states/states';
import { isApiError } from '@/lib/api/errors';

/**
 * PIN confirmation sheet for every money-out action.
 * - The parent owns the idempotent action (useIdempotentAction) and passes
 *   `pending` / `error`; this component only collects the PIN.
 * - Confirm is disabled while in flight, so double taps can't double-send
 *   (and the action hook reuses the same Idempotency-Key anyway).
 * - PIN_INVALID clears the field and shows attempts remaining; PIN_LOCKED disables entry.
 */
export function PinSheet({
  open,
  onOpenChange,
  title,
  description,
  summary,
  confirmLabel,
  onSubmit,
  pending,
  error,
  retrying,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  summary?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  onSubmit: (pin: string) => void;
  pending?: boolean;
  error?: unknown;
  retrying?: boolean;
}) {
  const t = useTranslations();
  const [pin, setPin] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const locked = isApiError(error) && error.code === 'PIN_LOCKED';
  const pinError = isApiError(error) && (error.code === 'PIN_INVALID' || error.code === 'PIN_LOCKED');

  // Reset the entered PIN when the sheet closes or a PIN error arrives
  // (state adjusted during render, React's recommended alternative to effects).
  const [prevOpen, setPrevOpen] = React.useState(open);
  const [prevError, setPrevError] = React.useState(error);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setPin('');
  }
  if (error !== prevError) {
    setPrevError(error);
    if (pinError) setPin('');
  }

  React.useEffect(() => {
    if (pinError) inputRef.current?.focus();
  }, [error, pinError]);

  const canSubmit = pin.length >= 4 && !pending && !locked;
  const submit = () => {
    if (canSubmit) onSubmit(pin);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent
        closeLabel={t('common.close')}
        hideClose={pending}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onPointerDownOutside={(e) => pending && e.preventDefault()}
        aria-describedby="pin-sheet-desc"
      >
        <DialogHeader>
          <div className="mb-2 inline-flex size-10 items-center justify-center rounded-full border border-accent/30 bg-accent-tint text-accent">
            <LockKeyhole className="size-5" aria-hidden />
          </div>
          <DialogTitle>{title ?? t('pin.title')}</DialogTitle>
          <DialogDescription id="pin-sheet-desc">{description ?? t('pin.subtitleGeneric')}</DialogDescription>
        </DialogHeader>

        {summary ? <div className="mb-5 rounded-lg border border-border bg-raised p-4">{summary}</div> : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-4"
        >
          <div className="flex justify-center">
            <CodeInput
              ref={inputRef}
              length={6}
              minLength={4}
              mask
              value={pin}
              onChange={setPin}
              disabled={pending || locked}
              autoFocus
              aria-label={t('pin.label')}
              aria-invalid={pinError || undefined}
              name="pin"
            />
          </div>
          {error ? <InlineError error={error} /> : null}
          {retrying ? (
            <p role="status" className="text-center text-xs text-fg-muted">
              {t('common.stillProcessing')}
            </p>
          ) : null}
          <Button type="submit" size="lg" block loading={pending} disabled={!canSubmit} data-testid="pin-confirm">
            {pending ? t('pin.authorising') : (confirmLabel ?? t('pin.confirm'))}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
