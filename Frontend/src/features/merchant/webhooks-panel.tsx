'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckCircle2, MoreHorizontal, Plus, RotateCw, Send, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Label } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, InlineError, QueryState, useErrorMessage } from '@/components/states/states';
import { webhookSchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { qk, useDeliveries, useQueryClient, useWebhooks } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import { WEBHOOK_EVENTS, type WebhookEndpoint } from '@/lib/api/contracts/future';
import { cn } from '@/lib/utils';
import { CheckGroup } from './check-group';
import { ConfirmDialog, SecretOnce } from './dialogs';
import { useDates } from './hooks';

type HookForm = z.input<typeof webhookSchema>;

export function WebhooksPanel() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const hooks = useWebhooks();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const selectedId = selected ?? hooks.data?.[0]?.id ?? null;
  const selectedHook = hooks.data?.find((h) => h.id === selectedId) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} data-testid="webhook-new">
          <Plus aria-hidden />
          {t('newWebhook')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-2 sm:pt-3">
          <QueryState
            query={hooks}
            skeleton={<ListSkeleton rows={2} label={tc('loading')} />}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title={t('noWebhooks')} body={t('noWebhooksBody')} />}
          >
            {(list) => (
              <ul className="divide-y divide-border" data-testid="webhooks-list">
                {list.map((w) => (
                  <WebhookRow key={w.id} hook={w} selected={w.id === selectedId} onSelect={() => setSelected(w.id)} />
                ))}
              </ul>
            )}
          </QueryState>
        </CardContent>
      </Card>
      {selectedHook ? <DeliveriesCard hook={selectedHook} /> : null}
      <CreateWebhookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function WebhookRow({
  hook: w,
  selected,
  onSelect,
}: {
  hook: WebhookEndpoint;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [secret, setSecret] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<'delete' | 'rotate' | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.webhooks });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => merchant.updateWebhook(w.id, { status: enabled ? 'ENABLED' : 'DISABLED' }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => merchant.testWebhook(w.id),
    onSuccess: async (r) => {
      const code = r.statusCode === null ? t('noResponse') : String(r.statusCode);
      if (r.ok) toast.success(t('testOk', { code }));
      else toast.error(t('testFailed', { code }));
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: qk.deliveries(w.id) })]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotate = useMutation({
    mutationFn: () => merchant.rotateWebhookSecret(w.id),
    onSuccess: async (r) => {
      setConfirm(null);
      setSecret(r.signingSecret);
      await invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => merchant.deleteWebhook(w.id),
    onSuccess: async () => {
      setConfirm(null);
      toast.success(t('webhookDeleted'));
      await invalidate();
    },
  });
  const switchId = React.useId();
  const enabled = toggle.isPending ? toggle.variables : w.status === 'ENABLED';

  return (
    <li
      className={cn(
        'flex flex-col gap-3 py-4 sm:flex-row sm:items-start',
        selected && 'sm:-mx-2 sm:rounded-md sm:bg-raised/40 sm:px-2',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <p dir="ltr" className="code text-start text-sm break-all text-fg">
          {w.url}
        </p>
        <ul className="flex flex-wrap gap-1" aria-label={t('events')}>
          {w.events.map((e) => (
            <li key={e}>
              <span className="code text-2xs rounded-sm border border-border bg-raised px-1.5 py-0.5 text-fg-muted">
                {e}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">
          {t('signingSecret')}:{' '}
          <code dir="ltr" className="code text-fg">
            {w.secretPrefix}…
          </code>
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <span>{t('lastDelivery')}:</span>
          {w.lastDelivery ? (
            <>
              <Badge tone={w.lastDelivery.ok ? 'success' : 'danger'}>
                {w.lastDelivery.statusCode ?? t('noResponse')}
              </Badge>
              <span>{dates.dateTime(w.lastDelivery.at)}</span>
            </>
          ) : (
            <span>{t('never')}</span>
          )}
        </p>
        <Button variant="link" size="sm" onClick={onSelect} aria-pressed={selected} className="h-auto text-xs">
          {t('showDeliveries')}
        </Button>
      </div>
      <div className="flex items-center gap-3 self-start">
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(c) => toggle.mutate(c)}
            data-testid="webhook-enabled"
          />
          <Label htmlFor={switchId} className="text-xs font-normal text-fg-muted">
            {t('webhookEnabled')}
          </Label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('endpointActions')}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => test.mutate()} disabled={test.isPending}>
              <Send aria-hidden />
              {t('sendTest')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                rotate.reset();
                setConfirm('rotate');
              }}
            >
              <RotateCw aria-hidden />
              {t('rotateSecret')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                remove.reset();
                setConfirm('delete');
              }}
              className="text-danger"
            >
              <Trash2 aria-hidden />
              {tc('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirm === 'rotate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('rotateTitle')}
        body={t('rotateConfirm')}
        confirmLabel={t('rotateSecret')}
        onConfirm={() => rotate.mutate()}
        pending={rotate.isPending}
        error={rotate.error}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('deleteWebhookTitle')}
        body={t('deleteWebhookConfirm')}
        confirmLabel={tc('delete')}
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
        error={remove.error}
      />
      <Dialog open={Boolean(secret)} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent closeLabel={tc('close')} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t('newSigningSecret')}</DialogTitle>
            <DialogDescription dir="ltr" className="text-start break-all">
              {w.url}
            </DialogDescription>
          </DialogHeader>
          {secret ? (
            <SecretOnce
              label={t('signingSecret')}
              secret={secret}
              warning={t('secretShown')}
              onDone={() => setSecret(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </li>
  );
}

function DeliveriesCard({ hook }: { hook: WebhookEndpoint }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const q = useDeliveries(hook.id);
  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-1">
        <CardTitle>{t('deliveries')}</CardTitle>
        <p dir="ltr" className="code text-start text-xs break-all text-fg-muted">
          {hook.url}
        </p>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <ListSkeleton rows={3} label={tc('loading')} />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('noDeliveries')}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={t('deliveriesFor', { url: hook.url })}>
            {q.data.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                {d.ok ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                ) : (
                  <XCircle className="size-4 text-danger" aria-hidden />
                )}
                <span className="sr-only">{d.ok ? t('delivered') : t('failed')}</span>
                <code className="code text-xs text-fg">{d.event}</code>
                <Badge tone={d.ok ? 'success' : 'danger'}>{d.statusCode ?? t('noResponse')}</Badge>
                <span className="text-xs text-fg-muted">{t('attempt', { n: d.attempt })}</span>
                <span className="text-xs text-fg-muted">{t('duration', { ms: d.durationMs })}</span>
                <span className="ms-auto text-xs text-fg-muted">{dates.dateTime(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CreateWebhookDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const [secret, setSecret] = React.useState<string | null>(null);
  const change = (o: boolean) => {
    if (!o) setSecret(null);
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={tc('close')} onInteractOutside={(e) => secret && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('newWebhook')}</DialogTitle>
          <DialogDescription>{t('noWebhooksBody')}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <SecretOnce
            label={t('signingSecret')}
            secret={secret}
            warning={t('secretShown')}
            onDone={() => change(false)}
          />
        ) : (
          <CreateWebhookForm onCreated={setSecret} onCancel={() => change(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog shows the form, so each opening starts clean. */
function CreateWebhookForm({ onCreated, onCancel }: { onCreated: (secret: string) => void; onCancel: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const qc = useQueryClient();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<HookForm>({
    resolver: zodResolver(webhookSchema),
    defaultValues: { url: '', events: ['payment.completed'] },
  });

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const created = await merchant.createWebhook({ url: v.url.trim(), events: v.events });
      onCreated(created.signingSecret);
      toast.success(t('webhookCreated'));
      await qc.invalidateQueries({ queryKey: qk.webhooks });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field label={t('endpointUrl')} hint={t('webhookHint')} error={fe(form.formState.errors.url)}>
        <Input
          type="url"
          dir="ltr"
          autoFocus
          placeholder="https://example.com/webhooks/paycore"
          data-testid="webhook-url"
          {...form.register('url')}
        />
      </Field>
      <Controller
        control={form.control}
        name="events"
        render={({ field }) => (
          <CheckGroup
            legend={t('events')}
            options={WEBHOOK_EVENTS}
            value={field.value}
            onChange={field.onChange}
            error={fe(form.formState.errors.events)}
            testIdPrefix="webhook-event"
          />
        )}
      />
      {error ? <InlineError error={error} /> : null}
      <DialogFooter className="mt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} data-testid="webhook-create">
          {tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
