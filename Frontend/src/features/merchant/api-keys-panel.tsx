'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { KeyRound, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { EmptyState, InlineError, QueryState } from '@/components/states/states';
import { apiKeySchema } from '@/lib/forms/schemas';
import { useFieldError } from '@/lib/forms/use-field-error';
import { qk, useApiKeys, useQueryClient } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import { API_KEY_SCOPES, type ApiKey, type ApiKeyCreated } from '@/lib/api/contracts/future';
import { CheckGroup } from './check-group';
import { ConfirmDialog, SecretOnce } from './dialogs';
import { useDates } from './hooks';

type KeyForm = z.input<typeof apiKeySchema>;

export function ApiKeysPanel() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const keys = useApiKeys();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => merchant.revokeApiKey(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.apiKeys });
      toast.success(t('keyRevoked'));
      setRevoking(null);
    },
  });

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} data-testid="api-key-new">
          <Plus aria-hidden />
          {t('newKey')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-2 sm:pt-3">
          <QueryState
            query={keys}
            skeleton={<ListSkeleton rows={3} label={tc('loading')} />}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title={t('noKeys')} body={t('noKeysBody')} />}
          >
            {(list) => (
              <ul className="divide-y divide-border" data-testid="api-keys-list">
                {list.map((k) => (
                  <ApiKeyRow
                    key={k.id}
                    apiKey={k}
                    onRevoke={() => {
                      revoke.reset();
                      setRevoking(k);
                    }}
                  />
                ))}
              </ul>
            )}
          </QueryState>
        </CardContent>
      </Card>
      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('revokeTitle')}
        body={t('revokeConfirm')}
        confirmLabel={tc('revoke')}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        pending={revoke.isPending}
        error={revoke.error}
      />
    </div>
  );
}

function ApiKeyRow({ apiKey: k, onRevoke }: { apiKey: ApiKey; onRevoke: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="size-4 text-fg-muted" aria-hidden />
          <span className="font-medium">{k.name}</span>
          <Badge tone={k.mode === 'LIVE' ? 'accent' : 'neutral'}>{k.mode === 'LIVE' ? t('live') : t('test')}</Badge>
          {k.revokedAt ? <Badge tone="danger">{t('revoked')}</Badge> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span>{t('prefix')}:</span>
          <code dir="ltr" className="code text-fg">
            {k.prefix}…
          </code>
        </p>
        <ul className="flex flex-wrap gap-1" aria-label={t('scopes')}>
          {k.scopes.map((s) => (
            <li key={s}>
              <span className="code text-2xs rounded-sm border border-border bg-raised px-1.5 py-0.5 text-fg-muted">
                {s}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">
          {tc('createdAt')} {dates.date(k.createdAt)} · {t('lastUsed')}{' '}
          {k.lastUsedAt ? dates.dateTime(k.lastUsedAt) : t('never')}
          {k.revokedAt ? ` · ${t('revoked')} ${dates.date(k.revokedAt)}` : ''}
        </p>
      </div>
      {k.revokedAt ? null : (
        <Button variant="danger" size="sm" onClick={onRevoke} className="self-start sm:self-center">
          {tc('revoke')}
          <span className="sr-only">{k.name}</span>
        </Button>
      )}
    </li>
  );
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const [created, setCreated] = React.useState<ApiKeyCreated | null>(null);
  const change = (o: boolean) => {
    if (!o) setCreated(null);
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={tc('close')} onInteractOutside={(e) => created && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('newKey')}</DialogTitle>
          <DialogDescription>{created ? created.name : t('developersDescription')}</DialogDescription>
        </DialogHeader>
        {created ? (
          <SecretOnce
            label={t('secretKey')}
            secret={created.secret}
            warning={t('keyCreated')}
            onDone={() => change(false)}
          />
        ) : (
          <CreateKeyForm onCreated={setCreated} onCancel={() => change(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog shows the form, so each opening starts clean. */
function CreateKeyForm({ onCreated, onCancel }: { onCreated: (k: ApiKeyCreated) => void; onCancel: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const qc = useQueryClient();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<KeyForm>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { name: '', mode: 'TEST', scopes: ['payments:read'] },
  });

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const k = await merchant.createApiKey({ name: v.name.trim(), mode: v.mode, scopes: v.scopes });
      onCreated(k);
      await qc.invalidateQueries({ queryKey: qk.apiKeys });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field label={t('keyName')} error={fe(form.formState.errors.name)}>
        <Input autoFocus data-testid="api-key-name" {...form.register('name')} />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg">{t('mode')}</span>
        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <Segmented
              label={t('mode')}
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'TEST', label: t('test') },
                { value: 'LIVE', label: t('live') },
              ]}
            />
          )}
        />
      </div>
      <Controller
        control={form.control}
        name="scopes"
        render={({ field }) => (
          <CheckGroup
            legend={t('scopes')}
            options={API_KEY_SCOPES}
            value={field.value}
            onChange={field.onChange}
            error={fe(form.formState.errors.scopes)}
            testIdPrefix="api-key-scope"
          />
        )}
      />
      {error ? <InlineError error={error} /> : null}
      <DialogFooter className="mt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} data-testid="api-key-create">
          {tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
