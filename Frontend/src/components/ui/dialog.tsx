'use client';

import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

type Side = 'center' | 'bottom' | 'end';

const contentBySide: Record<Side, string> = {
  // Responsive: bottom sheet on phones, centered modal from sm up.
  center:
    'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl border-t sm:inset-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-y-1/2 sm:rounded-xl sm:border rtl:sm:translate-x-1/2 ltr:sm:-translate-x-1/2 animate-[pc-slide-up_220ms_var(--pc-ease)] sm:animate-[pc-pop_180ms_var(--pc-ease)]',
  bottom: 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl border-t animate-[pc-slide-up_220ms_var(--pc-ease)]',
  end: 'inset-y-0 end-0 h-dvh w-full max-w-md border-s animate-[pc-slide-in-end_220ms_var(--pc-ease)]',
};

export function DialogContent({
  className,
  children,
  side = 'center',
  hideClose,
  closeLabel = 'Close',
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & { side?: Side; hideClose?: boolean; closeLabel?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 animate-[pc-fade-in_160ms_ease-out] bg-overlay backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-y-auto border-border bg-surface p-5 shadow-card focus-visible:outline-none',
          contentBySide[side],
          className,
        )}
        {...props}
      >
        {side !== 'end' ? (
          <div aria-hidden className="mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
        ) : null}
        {children}
        {hideClose ? null : (
          <D.Close
            className="absolute end-3 top-3 inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
            aria-label={closeLabel}
          >
            <X className="size-4" aria-hidden />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 grid gap-1 pe-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof D.Title>) {
  return <D.Title className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof D.Description>) {
  return <D.Description className={cn('text-sm text-fg-muted', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
