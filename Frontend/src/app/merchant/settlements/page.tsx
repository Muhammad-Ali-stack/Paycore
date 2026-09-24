'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, FileDown } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ListSkeleton, Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, QueryState, useErrorMessage } from '@/components/states/states';
import { useSettlements } from '@/lib/api/hooks';
import { merchant } from '@/lib/api/services';
import type { Settlement } from '@/lib/api/contracts/phase2';
import { downloadBlob, shortId } from '@/lib/utils';
import { MerchantGate } from '@/features/merchant/merchant-gate';
import { useDates, useSettlementDetail } from '@/features/merchant/hooks';

export default function MerchantSettlementsPage() {
  return <MerchantGate>{() => <Settlements />}</MerchantGate>;
}

function usePeriod() {
  const dates = useDates();
  return (s: Settlement) => `${dates.date(s.periodStart)} – ${dates.date(s.periodEnd)}`;
}

function Settlements() {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const period = usePeriod();
  const query = useSettlements();
  const [open, setOpen] = React.useState<Settlement | null>(null);

  return (
    <>
      <PageHeader title={t('settlementsTitle')} description={t('settlementsDescription')} />
      <Card>
        <CardContent className="pt-2 sm:pt-3">
          <QueryState
            query={query}
            skeleton={<ListSkeleton rows={6} label={tc('loading')} />}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState title={t('noSettlements')} body={t('noSettlementsBody')} />}
          >
            {(d) => (
              <>
                <ul className="divide-y divide-border lg:hidden">
                  {d.items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(s)}
                        aria-label={t('openSettlement', { period: period(s) })}
                        className="grid w-full gap-1 py-3 text-start hover:bg-raised/60"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{period(s)}</span>
                          <Amount money={s.net} className="font-medium" />
                        </span>
                        <span className="flex items-center justify-between gap-3 text-xs text-fg-muted">
                          <span>
                            {t('gross')} <Amount money={s.gross} size="xs" /> · {t('mdr')}{' '}
                            <Amount money={s.mdr} size="xs" />
                          </span>
                          <StatusBadge status={s.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full text-sm" data-testid="merchant-settlements-table">
                    <thead>
                      <tr className="border-b border-border text-xs text-fg-muted">
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {t('period')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('gross')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('mdr')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('refunds')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-end font-medium">
                          {t('net')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {tc('status')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {t('paidAt')}
                        </th>
                        <th scope="col" className="py-2 pe-3 text-start font-medium">
                          {t('bankReference')}
                        </th>
                        <th scope="col" className="w-8 py-2">
                          <span className="sr-only">{tc('details')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.items.map((s) => (
                        <tr key={s.id} onClick={() => setOpen(s)} className="cursor-pointer hover:bg-raised/60">
                          <td className="py-3 pe-3 whitespace-nowrap">{period(s)}</td>
                          <td className="py-3 pe-3 text-end">
                            <Amount money={s.gross} />
                          </td>
                          <td className="py-3 pe-3 text-end text-fg-muted">
                            <Amount money={s.mdr} />
                          </td>
                          <td className="py-3 pe-3 text-end text-fg-muted">
                            <Amount money={s.refunds} />
                          </td>
                          <td className="py-3 pe-3 text-end">
                            <Amount money={s.net} className="font-medium" />
                          </td>
                          <td className="py-3 pe-3">
                            <StatusBadge status={s.status} />
                          </td>
                          <td className="py-3 pe-3 whitespace-nowrap text-fg-muted">
                            {s.paidAt ? dates.date(s.paidAt) : '—'}
                          </td>
                          <td className="py-3 pe-3">
                            <span className="code text-xs text-fg-muted">{s.bankReference ?? '—'}</span>
                          </td>
                          <td className="py-3 text-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpen(s);
                              }}
                              aria-label={t('openSettlement', { period: period(s) })}
                              className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
                            >
                              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </QueryState>
        </CardContent>
      </Card>
      <SettlementDrawer settlement={open} onClose={() => setOpen(null)} />
    </>
  );
}

function SettlementDrawer({ settlement, onClose }: { settlement: Settlement | null; onClose: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const period = usePeriod();
  const errorMessage = useErrorMessage();
  const detail = useSettlementDetail(settlement?.id ?? null);
  const s = detail.data ?? settlement;
  const report = useMutation({
    mutationFn: (id: string) => merchant.settlementReport(id),
    onSuccess: (blob, id) => {
      downloadBlob(blob, `settlement-${id.slice(0, 8)}.csv`);
      toast.success(t('reportReady'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={Boolean(settlement)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="end" closeLabel={tc('close')}>
        {s ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('settlementDetail')}</DialogTitle>
              <DialogDescription>{period(s)}</DialogDescription>
            </DialogHeader>
            <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-border bg-raised p-6 text-center">
              <p className="text-sm text-fg-muted">{t('net')}</p>
              <Amount money={s.net} size="xl" />
              <StatusBadge status={s.status} />
            </div>
            <DetailList>
              <DetailRow label={t('gross')}>
                <Amount money={s.gross} />
              </DetailRow>
              <DetailRow label={t('mdr')}>
                <Amount money={s.mdr} direction="OUT" />
              </DetailRow>
              <DetailRow label={t('refunds')}>
                <Amount money={s.refunds} direction={s.refunds.amountMinor === '0' ? undefined : 'OUT'} />
              </DetailRow>
              <DetailRow label={t('net')} emphasis>
                <Amount money={s.net} />
              </DetailRow>
              <DetailRow label={t('paidAt')}>{s.paidAt ? dates.dateTime(s.paidAt) : '—'}</DetailRow>
              <DetailRow label={t('bankReference')}>
                <span className="code text-xs">{s.bankReference ?? '—'}</span>
              </DetailRow>
              <DetailRow label={tc('id')}>
                <span className="code text-xs">{shortId(s.id)}</span>
              </DetailRow>
            </DetailList>

            <Button
              variant="secondary"
              className="mt-6"
              onClick={() => report.mutate(s.id)}
              loading={report.isPending}
              data-testid="settlement-report"
            >
              <FileDown aria-hidden />
              {t('report')}
            </Button>

            <section className="mt-6" aria-labelledby="sd-lines">
              <h3 id="sd-lines" className="mb-3 text-sm font-semibold">
                {t('lines')}
              </h3>
              {detail.isPending ? (
                <SkeletonGroup label={tc('loading')}>
                  <Skeleton className="h-24" />
                </SkeletonGroup>
              ) : detail.isError ? (
                <ErrorState compact error={detail.error} onRetry={() => void detail.refetch()} />
              ) : !detail.data.lines?.length ? (
                <p className="text-sm text-fg-muted">{t('noLines')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {detail.data.lines.map((l, i) => (
                    <li key={l.refundId ?? l.paymentId ?? i} className="grid gap-1 px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="code text-xs text-fg-muted">
                          {l.kind === 'REFUND' ? '↺ ' : ''}
                          {shortId(l.refundId ?? l.paymentId ?? '')}
                        </span>
                        <Amount money={l.net} className="font-medium" />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-fg-muted">
                        <span>{dates.dateTime(l.occurredAt)}</span>
                        <span>
                          {t('gross')} <Amount money={l.gross} size="xs" /> · {t('mdr')}{' '}
                          <Amount money={l.mdr} size="xs" />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
