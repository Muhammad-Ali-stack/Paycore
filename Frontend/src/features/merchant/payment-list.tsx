'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Avatar } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/ui/status-badge';
import type { MerchantPayment } from '@/lib/api/contracts/phase2';
import { useDates } from './hooks';

/**
 * Payments as a proper table from md up and as stacked rows on phones.
 * Each row has one focusable button that opens the detail drawer.
 */
export function PaymentsTable({
  items,
  onOpen,
  compact,
}: {
  items: MerchantPayment[];
  onOpen: (p: MerchantPayment) => void;
  compact?: boolean;
}) {
  const t = useTranslations('merchant');
  const tc = useTranslations('common');
  const dates = useDates();
  return (
    <>
      <ul className="divide-y divide-border md:hidden" data-testid="merchant-payments-list">
        {items.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="flex w-full items-center gap-3 py-3 text-start hover:bg-raised/60"
              aria-label={t('openPayment', { name: p.payer.displayName })}
            >
              <Avatar name={p.payer.displayName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{p.payer.displayName}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {dates.dateTime(p.createdAt)}
                  {p.payee.outletName ? ` · ${p.payee.outletName}` : ''}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Amount money={p.amount} className="font-medium" />
                <StatusBadge status={p.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm" data-testid="merchant-payments-table">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {tc('date')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('payer')}
              </th>
              {compact ? null : (
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('outlet')}
                </th>
              )}
              <th scope="col" className="py-2 pe-3 text-end font-medium">
                {t('gross')}
              </th>
              {compact ? null : (
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {t('mdr')}
                </th>
              )}
              {compact ? null : (
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {t('net')}
                </th>
              )}
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {tc('status')}
              </th>
              <th scope="col" className="w-8 py-2">
                <span className="sr-only">{tc('details')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((p) => (
              <tr key={p.id} onClick={() => onOpen(p)} className="cursor-pointer hover:bg-raised/60">
                <td className="py-3 pe-3 whitespace-nowrap text-fg-muted">{dates.dateTime(p.createdAt)}</td>
                <td className="py-3 pe-3 font-medium text-fg">{p.payer.displayName}</td>
                {compact ? null : <td className="py-3 pe-3 text-fg-muted">{p.payee.outletName ?? '—'}</td>}
                <td className="py-3 pe-3 text-end">
                  <Amount money={p.amount} />
                </td>
                {compact ? null : (
                  <td className="py-3 pe-3 text-end text-fg-muted">
                    <Amount money={p.mdrFee} />
                  </td>
                )}
                {compact ? null : (
                  <td className="py-3 pe-3 text-end">
                    <Amount money={p.net} className="font-medium" />
                  </td>
                )}
                <td className="py-3 pe-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="py-3 text-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p);
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
                    aria-label={t('openPayment', { name: p.payer.displayName })}
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
  );
}
