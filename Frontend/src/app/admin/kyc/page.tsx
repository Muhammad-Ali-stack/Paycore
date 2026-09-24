'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRight, Check, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger, Avatar } from '@/components/ui/primitives';
import { ListSkeleton } from '@/components/ui/skeleton';
import { EmptyState, QueryState } from '@/components/states/states';
import { useKycQueue, useQueryClient } from '@/lib/api/hooks';
import { admin } from '@/lib/api/services';
import type { KycSubmission } from '@/lib/api/contracts/phase1';
import { NoteDialog, useDateTime } from '@/features/admin/shared';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type KycStatus = (typeof STATUSES)[number];

function KycCard({ s, onApprove, onReject }: { s: KycSubmission; onApprove: () => void; onReject: () => void }) {
  const t = useTranslations();
  const dt = useDateTime();
  const tier = (k: string) =>
    t.has(`kyc.tiers.${k}` as 'kyc.tiers.TIER_0') ? t(`kyc.tiers.${k}` as 'kyc.tiers.TIER_0') : k;
  const doc = (k: string) =>
    t.has(`kyc.documents.${k}` as 'kyc.documents.CNIC') ? t(`kyc.documents.${k}` as 'kyc.documents.CNIC') : k;
  const name = s.applicant?.fullName ?? t('admin.kycq.unknownApplicant');
  const headingId = `kyc-${s.id}`;
  return (
    <Card className="p-5">
      <article aria-labelledby={headingId} className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} />
            <div className="min-w-0">
              <h3 id={headingId} className="truncate text-sm font-semibold text-fg">
                {name}
              </h3>
              {s.applicant?.phoneMasked ? (
                <span className="code block text-xs text-fg-muted">{s.applicant.phoneMasked}</span>
              ) : (
                <span className="code block text-xs text-fg-muted">{s.userId.slice(0, 8)}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={s.status} />
            <span className="text-xs text-fg-muted">
              {t('admin.submitted')}: {dt(s.createdAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-raised px-3 py-2 text-sm">
          <span className="text-fg-muted">{t('admin.kycq.tierChange')}</span>
          <span className="font-medium text-fg">{s.applicant ? tier(s.applicant.currentTier) : '–'}</span>
          <ArrowRight className="size-4 text-fg-muted rtl:rotate-180" aria-hidden />
          <span className="sr-only">{t('admin.target')}</span>
          <span className="font-medium text-accent-text">{tier(s.targetTier)}</span>
        </div>

        <DetailList className="sm:grid-cols-2 sm:gap-x-8">
          <DetailRow label={t('admin.document')}>
            <span className="block">{doc(s.documentType)}</span>
            {/* The backend only ever returns the last 4 characters. */}
            <span className="code block text-xs text-fg-muted" aria-label={t('admin.kycq.documentNumber')}>
              •••• {s.documentNumberLast4}
            </span>
          </DetailRow>
          <DetailRow label={t('admin.kycq.businessName')}>{s.businessName ?? '–'}</DetailRow>
          {s.documentRef ? (
            <DetailRow label={t('kyc.upload')}>
              <span className="code text-xs">{s.documentRef.split('/').pop()}</span>
            </DetailRow>
          ) : null}
          {s.reviewedAt ? <DetailRow label={t('admin.kycq.reviewedAt')}>{dt(s.reviewedAt)}</DetailRow> : null}
          {s.rejectionReason ? <DetailRow label={t('admin.rejectReason')}>{s.rejectionReason}</DetailRow> : null}
        </DetailList>

        {s.status === 'PENDING' ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="danger" size="sm" onClick={onReject}>
              <X aria-hidden />
              {t('admin.reject')}
              <span className="sr-only">: {name}</span>
            </Button>
            <Button size="sm" onClick={onApprove}>
              <Check aria-hidden />
              {t('admin.approve')}
              <span className="sr-only">: {name}</span>
            </Button>
          </div>
        ) : null}
      </article>
    </Card>
  );
}

function KycList({ status }: { status: KycStatus }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const query = useKycQueue(status);
  const [approveFor, setApproveFor] = React.useState<KycSubmission | null>(null);
  const [rejectFor, setRejectFor] = React.useState<KycSubmission | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'kyc'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);

  return (
    <>
      <QueryState
        query={query}
        skeleton={<ListSkeleton rows={3} label={t('states.loadingList')} />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            title={status === 'PENDING' ? t('admin.queueEmpty') : t('admin.kycq.emptyReviewed')}
            body={status === 'PENDING' ? t('admin.queueEmptyBody') : undefined}
          />
        }
      >
        {(items) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {[...items]
              .sort((a, b) =>
                status === 'PENDING' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt),
              )
              .map((s) => (
                <li key={s.id}>
                  <KycCard s={s} onApprove={() => setApproveFor(s)} onReject={() => setRejectFor(s)} />
                </li>
              ))}
          </ul>
        )}
      </QueryState>

      <NoteDialog
        open={Boolean(approveFor)}
        onOpenChange={(o) => !o && setApproveFor(null)}
        title={t('admin.kycq.approveTitle')}
        description={approveFor?.applicant?.fullName}
        label={t('admin.approveNote')}
        confirmLabel={t('admin.approve')}
        onSubmit={async (note) => {
          await admin.approveKyc(approveFor!.id, note || undefined);
          await refresh();
          toast.success(t('admin.kycq.approvedToast'));
        }}
      />
      <NoteDialog
        open={Boolean(rejectFor)}
        onOpenChange={(o) => !o && setRejectFor(null)}
        title={t('admin.kycq.rejectTitle')}
        description={rejectFor?.applicant?.fullName}
        label={t('admin.rejectReason')}
        placeholder={t('admin.kycq.rejectPlaceholder')}
        minLength={5}
        tone="danger"
        confirmLabel={t('admin.reject')}
        onSubmit={async (reason) => {
          await admin.rejectKyc(rejectFor!.id, reason);
          await refresh();
          toast.success(t('admin.kycq.rejectedToast'));
        }}
      />
    </>
  );
}

export default function AdminKycPage() {
  const t = useTranslations();
  const [tab, setTab] = React.useState<KycStatus>('PENDING');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.kycTitle')} description={t('admin.kycq.subtitle')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as KycStatus)}>
        <TabsList aria-label={t('common.status')} className="mb-5">
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`status.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {STATUSES.map((s) => (
          <TabsContent key={s} value={s} className="focus-visible:outline-none">
            <KycList status={s} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
