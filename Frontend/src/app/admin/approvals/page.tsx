'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Info, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, QueryState } from '@/components/states/states';
import { useApprovals, useMe, useQueryClient } from '@/lib/api/hooks';
import { admin } from '@/lib/api/services';
import type { ApprovalRequest } from '@/lib/api/contracts/future';
import { shortId } from '@/lib/utils';
import { JsonBlock, NoteDialog, useDateTime } from '@/features/admin/shared';

const TABS = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const;
type Tab = (typeof TABS)[number];

function ApprovalCard({
  a,
  meId,
  onApprove,
  onReject,
}: {
  a: ApprovalRequest;
  meId?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const t = useTranslations();
  const dt = useDateTime();
  const format = useFormatter();
  const own = Boolean(meId && meId === a.maker.id);
  const headingId = `appr-${a.id}`;
  const hintId = `appr-hint-${a.id}`;
  const actionLabel = t(`admin.actions.${a.action}`);
  const hasPayload = Object.keys(a.payload).length > 0;

  return (
    <Card className="p-5">
      <article aria-labelledby={headingId} className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={headingId} className="text-sm font-semibold text-fg">
              {actionLabel}
            </h3>
            <p className="truncate text-sm text-fg-muted">
              {a.targetLabel} · <span className="code text-xs">{a.targetType}</span>{' '}
              <span className="code text-xs" title={a.targetId}>
                {shortId(a.targetId)}
              </span>
            </p>
          </div>
          <StatusBadge status={a.status} />
        </div>

        <blockquote className="rounded-md border-s-2 border-accent bg-raised px-3 py-2 text-sm text-fg">
          {a.reason}
        </blockquote>

        <DetailList className="sm:grid-cols-2 sm:gap-x-8">
          <DetailRow label={t('admin.maker')}>
            {a.maker.displayName}
            {own ? <span className="text-fg-muted"> ({t('admin.approvals.you')})</span> : null}
          </DetailRow>
          <DetailRow label={t('common.createdAt')}>{dt(a.createdAt)}</DetailRow>
          {a.status === 'PENDING' ? (
            <DetailRow label={t('admin.approvals.expires')}>
              <time dateTime={a.expiresAt} title={dt(a.expiresAt)}>
                {format.relativeTime(new Date(a.expiresAt), new Date())}
              </time>
            </DetailRow>
          ) : (
            <DetailRow label={t('admin.approvals.expires')}>{dt(a.expiresAt)}</DetailRow>
          )}
          {a.checker ? <DetailRow label={t('admin.checker')}>{a.checker.displayName}</DetailRow> : null}
          {a.decidedAt ? <DetailRow label={t('admin.approvals.decidedAt')}>{dt(a.decidedAt)}</DetailRow> : null}
          {a.decisionNote ? <DetailRow label={t('admin.decisionNote')}>{a.decisionNote}</DetailRow> : null}
        </DetailList>

        {hasPayload ? (
          <div className="grid gap-1.5">
            <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">{t('admin.approvals.payload')}</p>
            <JsonBlock value={a.payload} />
          </div>
        ) : null}

        {a.status === 'PENDING' ? (
          <div className="grid gap-2 border-t border-border pt-4">
            {own ? (
              <p id={hintId} className="flex items-center gap-2 text-sm text-warning">
                <Info className="size-4 shrink-0" aria-hidden />
                {t('admin.yourRequest')}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" size="sm" onClick={onReject}>
                <X aria-hidden />
                {t('admin.reject')}
                <span className="sr-only">
                  : {actionLabel}, {a.targetLabel}
                </span>
              </Button>
              <Button size="sm" onClick={onApprove} disabled={own} aria-describedby={own ? hintId : undefined}>
                <Check aria-hidden />
                {t('admin.approve')}
                <span className="sr-only">
                  : {actionLabel}, {a.targetLabel}
                </span>
              </Button>
            </div>
          </div>
        ) : null}
      </article>
    </Card>
  );
}

function ApprovalList({ status }: { status: Tab }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const me = useMe();
  const query = useApprovals(status);
  const [approveFor, setApproveFor] = React.useState<ApprovalRequest | null>(null);
  const [rejectFor, setRejectFor] = React.useState<ApprovalRequest | null>(null);

  // Approving applies the change (wallet/user status), so every admin view can be stale.
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  return (
    <>
      <QueryState
        query={query}
        skeleton={<ListSkeleton rows={3} label={t('states.loadingList')} />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title={status === 'PENDING' ? t('admin.queueEmpty') : t('admin.approvals.emptyTitle')}
            body={status === 'PENDING' ? t('admin.approvals.emptyPendingBody') : undefined}
          />
        }
      >
        {(d) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {d.items.map((a) => (
              <li key={a.id}>
                <ApprovalCard
                  a={a}
                  meId={me.data?.id}
                  onApprove={() => setApproveFor(a)}
                  onReject={() => setRejectFor(a)}
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <NoteDialog
        open={Boolean(approveFor)}
        onOpenChange={(o) => !o && setApproveFor(null)}
        title={approveFor ? t('admin.approvals.approveTitle', { action: t(`admin.actions.${approveFor.action}`) }) : ''}
        description={approveFor ? `${approveFor.targetLabel}. ${t('admin.approvals.approveBody')}` : undefined}
        label={t('admin.approveNote')}
        confirmLabel={t('admin.approve')}
        onSubmit={async (note) => {
          await admin.approve(approveFor!.id, note || undefined);
          await refresh();
          toast.success(t('admin.approvedToast'));
        }}
      />
      <NoteDialog
        open={Boolean(rejectFor)}
        onOpenChange={(o) => !o && setRejectFor(null)}
        title={rejectFor ? t('admin.approvals.rejectTitle', { action: t(`admin.actions.${rejectFor.action}`) }) : ''}
        description={rejectFor?.targetLabel}
        label={t('admin.decisionNote')}
        minLength={3}
        tone="danger"
        confirmLabel={t('admin.reject')}
        onSubmit={async (note) => {
          await admin.reject(rejectFor!.id, note);
          await refresh();
          toast.success(t('admin.rejectedToast'));
        }}
      />
    </>
  );
}

export default function AdminApprovalsPage() {
  const t = useTranslations();
  const [tab, setTab] = React.useState<Tab>('PENDING');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.approvalsTitle')} description={t('admin.makerCheckerHint')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label={t('common.status')} className="mb-5">
          {TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'ALL' ? t('common.all') : t(`status.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((s) => (
          <TabsContent key={s} value={s} className="focus-visible:outline-none">
            <ApprovalList status={s} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
