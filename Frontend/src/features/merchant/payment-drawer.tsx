'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Undo2 } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import type { MerchantPayment } from '@/lib/api/contracts/phase2';
import { shortId } from '@/lib/utils';
import { useDates, useMerchantPayment } from './hooks';
import { RefundDialog, canRefund } from './refund-dialog';

/** Side drawer with the payment breakdown, timeline and refund action. */
export function PaymentDrawer({ payment, onClose }: { payment: MerchantPayment | null; onClose: () => void }) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  const fresh = useMerchantPayment(payment?.id ?? null);
  const p = fresh.data ?? payment;
  const [refundOpen, setRefundOpen] = React.useState(false);

  return (
    <Dialog open={Boolean(payment)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="end" closeLabel={tc('close')} aria-describedby={undefined}>
        {p ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('paymentDetail')}</DialogTitle>
              <DialogDescription>{dates.dateTime(p.createdAt)}</DialogDescription>
            </DialogHeader>
            <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-border bg-raised p-6 text-center">
              <p className="text-sm text-fg-muted">{p.payer.displayName}</p>
              <Amount money={p.amount} size="xl" />
              <StatusBadge status={p.status} />
            </div>

            <section aria-labelledby="pd-breakdown">
              <h3 id="pd-breakdown" className="mb-3 text-sm font-semibold">
                {t('breakdown')}
              </h3>
              <DetailList>
                <DetailRow label={t('gross')}>
                  <Amount money={p.amount} />
                </DetailRow>
                <DetailRow label={t('mdr')}>
                  <Amount money={p.mdrFee} direction="OUT" />
                </DetailRow>
                <DetailRow label={t('refunded')}>
                  <Amount
                    money={p.refundedAmount}
                    direction={p.refundedAmount.amountMinor === '0' ? undefined : 'OUT'}
                  />
                </DetailRow>
                <DetailRow label={t('net')} emphasis>
                  <Amount money={p.net} />
                </DetailRow>
              </DetailList>
            </section>

            <DetailList className="mt-6">
              {p.payee.outletName ? <DetailRow label={t('outlet')}>{p.payee.outletName}</DetailRow> : null}
              {p.reference ? <DetailRow label={tc('reference')}>{p.reference}</DetailRow> : null}
              <DetailRow label={tc('id')}>
                <span className="code text-xs">{shortId(p.id)}</span>
              </DetailRow>
            </DetailList>

            {p.timeline.length ? (
              <section className="mt-6" aria-labelledby="pd-timeline">
                <h3 id="pd-timeline" className="mb-3 text-sm font-semibold">
                  {t('timeline')}
                </h3>
                <ol className="relative grid gap-3 border-s border-border ps-4">
                  {p.timeline.map((e, i) => (
                    <li key={i} className="relative">
                      <span
                        aria-hidden
                        className="absolute -start-[21px] top-1 size-2.5 rounded-full border-2 border-bg bg-accent"
                      />
                      <StatusBadge status={e.status} />
                      <span className="ms-2 text-xs text-fg-muted">{dates.dateTime(e.at)}</span>
                      {e.reason ? <p className="mt-1 text-xs text-fg-muted">{e.reason}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              {canRefund(p) ? (
                <Button variant="outline" onClick={() => setRefundOpen(true)} data-testid="payment-refund">
                  <Undo2 aria-hidden />
                  {t('refund')}
                </Button>
              ) : (
                <p className="w-full text-sm text-fg-muted">
                  {p.status === 'REFUNDED' ? t('fullyRefunded') : t('notRefundable')}
                </p>
              )}
              <CopyButton value={p.id} label={tc('id')} />
            </div>
            <RefundDialog payment={p} open={refundOpen} onOpenChange={setRefundOpen} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
