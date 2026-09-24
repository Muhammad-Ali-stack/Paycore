'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { Lock, UserPlus } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Label, Textarea } from '@/components/ui/input';
import { Checkbox, Progress, Segmented, Separator } from '@/components/ui/primitives';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErrorState } from '@/components/states/states';
import { qk, useFraudCase, useMe, useQueryClient } from '@/lib/api/hooks';
import { admin } from '@/lib/api/services';
import type { FraudCase } from '@/lib/api/contracts/future';
import { shortId } from '@/lib/utils';
import { AdminInlineError, NoteDialog, SeverityBadge, useDateTime } from './shared';

export const isClosed = (c: Pick<FraudCase, 'status'>) => c.status.startsWith('CLOSED');

/** Store the returned case and refresh lists/audit. */
function useCaseUpdated() {
  const qc = useQueryClient();
  return React.useCallback(
    async (c: FraudCase, extra: 'approvals' | null = null) => {
      qc.setQueryData(qk.admin.fraudCase(c.id), c);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'fraud'], predicate: (q) => q.queryKey[2] !== 'case' }),
        qc.invalidateQueries({ queryKey: ['admin', 'audit'] }),
        extra === 'approvals' ? qc.invalidateQueries({ queryKey: ['admin', 'approvals'] }) : null,
      ]);
    },
    [qc],
  );
}

const resolveSchema = z.object({
  resolution: z.enum(['CLOSED_FRAUD', 'CLOSED_LEGIT']),
  note: z.string().trim().min(5, 'min').max(1000, 'max'),
  freezeWallets: z.boolean(),
});
type ResolveForm = z.infer<typeof resolveSchema>;

function ResolveDialog({ c, open, onOpenChange }: { c: FraudCase; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const updated = useCaseUpdated();
  const form = useForm<ResolveForm>({
    resolver: zodResolver(resolveSchema),
    defaultValues: { resolution: 'CLOSED_FRAUD', note: '', freezeWallets: false },
  });
  const resolution = useWatch({ control: form.control, name: 'resolution' });
  const mutation = useMutation({
    mutationFn: (v: ResolveForm) =>
      admin.resolveFraudCase(c.id, {
        resolution: v.resolution,
        note: v.note.trim(),
        freezeWallets: v.resolution === 'CLOSED_FRAUD' ? v.freezeWallets : undefined,
      }),
    onSuccess: async (res, v) => {
      const freeze = v.resolution === 'CLOSED_FRAUD' && v.freezeWallets;
      await updated(res, freeze ? 'approvals' : null);
      toast.success(freeze ? t('admin.fraud.resolvedWithFreeze') : t('admin.fraud.resolvedToast'));
      onOpenChange(false);
    },
  });
  React.useEffect(() => {
    if (!open) {
      form.reset();
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const noteErr = form.formState.errors.note;
  const freezeId = React.useId();

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('admin.fraud.resolveTitle')}</DialogTitle>
          <DialogDescription>
            {c.subject.displayName} · <span className="code">{c.ruleCode}</span>
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-fg">{t('admin.resolution')}</span>
            <Controller
              control={form.control}
              name="resolution"
              render={({ field }) => (
                <Segmented
                  label={t('admin.resolution')}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'CLOSED_FRAUD', label: t('admin.closedFraud') },
                    { value: 'CLOSED_LEGIT', label: t('admin.closedLegit') },
                  ]}
                />
              )}
            />
          </div>
          <Field
            label={t('common.note')}
            error={
              noteErr
                ? noteErr.message === 'max'
                  ? t('admin.form.maxChars', { max: 1000 })
                  : t('admin.form.minChars', { min: 5 })
                : undefined
            }
            hint={t('admin.form.minChars', { min: 5 })}
          >
            <Textarea rows={3} placeholder={t('admin.notePlaceholder')} {...form.register('note')} />
          </Field>
          {resolution === 'CLOSED_FRAUD' ? (
            <div className="flex items-start gap-3 rounded-md border border-border bg-raised p-3">
              <Controller
                control={form.control}
                name="freezeWallets"
                render={({ field }) => (
                  <Checkbox
                    id={freezeId}
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    className="mt-0.5"
                  />
                )}
              />
              <div className="grid gap-0.5">
                <Label htmlFor={freezeId}>{t('admin.freezeWallets')}</Label>
                <p className="text-xs text-fg-muted">{t('admin.fraud.freezeHint')}</p>
              </div>
            </div>
          ) : null}
          <div aria-live="polite">
            <AdminInlineError error={mutation.error} />
          </div>
          <DialogFooter className="mt-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={resolution === 'CLOSED_FRAUD' ? 'danger' : 'primary'}
              loading={mutation.isPending}
            >
              {t('admin.resolve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddNote({ c }: { c: FraudCase }) {
  const t = useTranslations();
  const updated = useCaseUpdated();
  const [body, setBody] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const id = React.useId();
  const mutation = useMutation({
    mutationFn: (text: string) => admin.addFraudNote(c.id, text),
    onSuccess: async (res) => {
      setBody('');
      setTouched(false);
      await updated(res);
      toast.success(t('admin.fraud.noteAdded'));
    },
  });
  const tooShort = body.trim().length < 2;
  return (
    <form
      noValidate
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!tooShort) mutation.mutate(body.trim());
      }}
    >
      <Field
        label={t('admin.addNote')}
        error={touched && tooShort ? t('admin.form.minChars', { min: 2 }) : undefined}
        id={id}
      >
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('admin.notePlaceholder')}
          maxLength={1000}
        />
      </Field>
      <div aria-live="polite">
        <AdminInlineError error={mutation.error} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" size="sm" loading={mutation.isPending}>
          {t('admin.addNote')}
        </Button>
      </div>
    </form>
  );
}

function CaseBody({ c }: { c: FraudCase }) {
  const t = useTranslations();
  const dt = useDateTime();
  const me = useMe();
  const updated = useCaseUpdated();
  const [escalateOpen, setEscalateOpen] = React.useState(false);
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const closed = isClosed(c);
  const assign = useMutation({
    mutationFn: () => admin.assignFraudCase(c.id),
    onSuccess: async (res) => {
      await updated(res);
      toast.success(t('admin.fraud.assignedToast'));
    },
  });
  const mine = Boolean(me.data && c.assignee?.id === me.data.id);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 rounded-lg border border-border bg-raised p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={c.severity} />
          <StatusBadge status={c.status} />
          <span className="code text-xs text-fg-muted">{c.ruleCode}</span>
        </div>
        <p className="text-sm text-fg">{c.summary}</p>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>{t('admin.score')}</span>
            <span className="money text-fg">{c.score}/100</span>
          </div>
          <Progress value={c.score} label={t('admin.riskScoreValue', { score: c.score })} />
        </div>
      </div>

      <DetailList>
        <DetailRow label={t('admin.subject')}>
          <span className="block">{c.subject.displayName}</span>
          <span className="code block text-xs text-fg-muted" dir="ltr">
            {c.subject.phoneMasked}
          </span>
        </DetailRow>
        <DetailRow label={t('admin.rule')}>
          <span className="code">{c.ruleCode}</span>
        </DetailRow>
        <DetailRow label={t('common.amount')}>{c.amount ? <Amount money={c.amount} /> : '–'}</DetailRow>
        <DetailRow label={t('admin.assignee')}>{c.assignee?.displayName ?? t('admin.unassigned')}</DetailRow>
        <DetailRow label={t('common.createdAt')}>{dt(c.createdAt)}</DetailRow>
        <DetailRow label={t('admin.fraud.updatedAt')}>{dt(c.updatedAt)}</DetailRow>
      </DetailList>

      {c.relatedPaymentIds.length ? (
        <section aria-labelledby="fraud-related-h" className="grid gap-2">
          <h3 id="fraud-related-h" className="text-xs font-medium tracking-wider text-fg-muted uppercase">
            {t('admin.fraud.relatedPayments')}
          </h3>
          <ul className="grid gap-2">
            {c.relatedPaymentIds.map((pid) => (
              <li
                key={pid}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="code text-sm" title={pid}>
                  {shortId(pid)}
                </span>
                <CopyButton value={pid} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {closed ? (
        <p className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-2 text-sm text-fg-muted">
          <Lock className="size-4 shrink-0" aria-hidden />
          {t('admin.fraud.readOnly')}
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {!mine ? (
              <Button variant="secondary" size="sm" onClick={() => assign.mutate()} loading={assign.isPending}>
                <UserPlus aria-hidden />
                {t('admin.assignToMe')}
              </Button>
            ) : null}
            {c.status !== 'ESCALATED' ? (
              <Button variant="outline" size="sm" onClick={() => setEscalateOpen(true)}>
                {t('admin.escalate')}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setResolveOpen(true)}>
              {t('admin.resolve')}
            </Button>
          </div>
          <div aria-live="polite">
            <AdminInlineError error={assign.error} />
          </div>
        </div>
      )}

      <Separator />

      <section aria-labelledby="fraud-notes-h" className="grid gap-4">
        <h3 id="fraud-notes-h" className="text-sm font-semibold text-fg">
          {t('admin.notes')}
        </h3>
        {c.notes.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('admin.fraud.noNotes')}</p>
        ) : (
          <ol className="grid gap-4 border-s border-border ps-4">
            {[...c.notes]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((n) => (
                <li key={n.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border border-accent bg-bg"
                  />
                  <p className="text-xs text-fg-muted">
                    <span className="font-medium text-fg">{n.author}</span> · {dt(n.at)}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-fg">{n.body}</p>
                </li>
              ))}
          </ol>
        )}
        {closed ? null : <AddNote c={c} />}
      </section>

      <NoteDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title={t('admin.fraud.escalateTitle')}
        description={t('admin.fraud.escalateBody')}
        label={t('common.note')}
        minLength={5}
        tone="danger"
        confirmLabel={t('admin.escalate')}
        onSubmit={async (note) => {
          const res = await admin.escalateFraudCase(c.id, note);
          await updated(res);
          toast.success(t('admin.fraud.escalatedToast'));
        }}
      />
      <ResolveDialog c={c} open={resolveOpen} onOpenChange={setResolveOpen} />
    </div>
  );
}

export function FraudCaseDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations();
  const query = useFraudCase(id);
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="end" closeLabel={t('common.close')} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('admin.fraud.caseTitle')}</DialogTitle>
          {query.data ? (
            <p className="text-sm text-fg-muted">
              {query.data.subject.displayName} · <span className="code">{shortId(query.data.id)}</span>
            </p>
          ) : null}
        </DialogHeader>
        {query.isPending ? (
          <SkeletonGroup label={t('common.loading')} className="grid gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24" />
          </SkeletonGroup>
        ) : query.isError || !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : (
          <CaseBody c={query.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}
