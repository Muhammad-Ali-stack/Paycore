'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { MapPin, MonitorSmartphone, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, InlineError, QueryState } from '@/components/states/states';
import { useFieldError } from '@/lib/forms/use-field-error';
import { qk, useOutlets, useQueryClient, useTerminals } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import type { Outlet } from '@/lib/api/contracts/phase2';
import { QrCode } from '@/features/qr/qr-code';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { useDates } from '@/features/merchant/hooks';

const outletSchema = z.object({
  name: z.string().trim().min(2, 'required').max(120),
  address: z.string().trim().max(300),
});
const terminalSchema = z.object({ label: z.string().trim().min(2, 'required').max(60) });

export default function MerchantOutletsPage() {
  return <MerchantGate>{() => <Outlets />}</MerchantGate>;
}

function Outlets() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const outlets = useOutlets();
  const [addOpen, setAddOpen] = React.useState(false);
  return (
    <>
      <PageHeader
        title={t('outletsTitle')}
        description={t('outletsDescription')}
        actions={
          <Button onClick={() => setAddOpen(true)} data-testid="add-outlet">
            <Plus aria-hidden />
            {t('addOutlet')}
          </Button>
        }
      />
      <QueryState
        query={outlets}
        skeleton={
          <SkeletonGroup label={tc('loading')} className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </SkeletonGroup>
        }
        isEmpty={(d) => d.length === 0}
        empty={
          <Card>
            <EmptyState
              title={t('noOutlets')}
              body={t('noOutletsBody')}
              action={<Button onClick={() => setAddOpen(true)}>{t('addOutlet')}</Button>}
            />
          </Card>
        }
      >
        {(list) => (
          <ul className="grid gap-4 md:grid-cols-2">
            {list.map((o) => (
              <li key={o.id}>
                <OutletCard outlet={o} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <AddOutletDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

function OutletCard({ outlet }: { outlet: Outlet }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const terminals = useTerminals(outlet.id);
  const [addOpen, setAddOpen] = React.useState(false);
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <QrCode
          payload={outlet.staticQr.payload}
          size={96}
          withLogo={false}
          label={t('staticQrLabel', { name: outlet.name })}
          className="shrink-0 p-1.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{outlet.name}</h2>
            <StatusBadge status={outlet.status} />
          </div>
          {outlet.address ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-fg-muted">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{outlet.address}</span>
            </p>
          ) : null}
          <p className="mt-1 text-xs text-fg-muted">
            {tc('createdAt')} {dates.date(outlet.createdAt)}
          </p>
        </div>
      </div>

      <section aria-label={`${t('terminals')} · ${outlet.name}`} className="grid gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('terminals')}</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddOpen(true)}
            aria-label={t('addTerminalTo', { name: outlet.name })}
          >
            <Plus aria-hidden />
            {t('addTerminal')}
          </Button>
        </div>
        {terminals.isPending ? (
          <SkeletonGroup label={tc('loading')}>
            <Skeleton className="h-9" />
          </SkeletonGroup>
        ) : terminals.isError ? (
          <ErrorState compact error={terminals.error} onRetry={() => void terminals.refetch()} />
        ) : terminals.data.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('noTerminals')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {terminals.data.map((term) => (
              <li
                key={term.id}
                className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-2 text-sm"
              >
                <MonitorSmartphone className="size-4 text-fg-muted" aria-hidden />
                <span className="flex-1 truncate">{term.label}</span>
                <StatusBadge status={term.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddTerminalDialog outlet={outlet} open={addOpen} onOpenChange={setAddOpen} />
    </Card>
  );
}

function AddOutletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addOutlet')}</DialogTitle>
          <DialogDescription>{t('staticQrBody')}</DialogDescription>
        </DialogHeader>
        <AddOutletForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts clean. */
function AddOutletForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const qc = useQueryClient();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<z.input<typeof outletSchema>, unknown, z.output<typeof outletSchema>>({
    resolver: zodResolver(outletSchema),
    defaultValues: { name: '', address: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await merchant.createOutlet({ name: v.name, address: v.address || undefined });
      await qc.invalidateQueries({ queryKey: qk.outlets });
      toast.success(t('outletCreated'));
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field label={t('outletName')} error={fe(form.formState.errors.name)}>
        <Input autoFocus {...form.register('name')} />
      </Field>
      <Field label={t('address')} optional={tc('optional')} error={fe(form.formState.errors.address)}>
        <Input placeholder={t('addressPlaceholder')} {...form.register('address')} />
      </Field>
      {error ? <InlineError error={error} /> : null}
      <DialogFooter className="mt-1">
        <Button type="button" variant="secondary" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddTerminalDialog({
  outlet,
  open,
  onOpenChange,
}: {
  outlet: Outlet;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addTerminal')}</DialogTitle>
          <DialogDescription>{t('addTerminalTo', { name: outlet.name })}</DialogDescription>
        </DialogHeader>
        <AddTerminalForm outlet={outlet} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddTerminalForm({ outlet, onDone }: { outlet: Outlet; onDone: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const qc = useQueryClient();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<z.input<typeof terminalSchema>, unknown, z.output<typeof terminalSchema>>({
    resolver: zodResolver(terminalSchema),
    defaultValues: { label: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await merchant.createTerminal(outlet.id, v.label);
      await qc.invalidateQueries({ queryKey: qk.terminals(outlet.id) });
      toast.success(t('terminalCreated'));
      onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field label={t('terminalLabel')} error={fe(form.formState.errors.label)}>
        <Input autoFocus placeholder={t('terminalPlaceholder')} {...form.register('label')} />
      </Field>
      {error ? <InlineError error={error} /> : null}
      <DialogFooter className="mt-1">
        <Button type="button" variant="secondary" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
