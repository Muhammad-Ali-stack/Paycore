'use client';

/** Merchant-portal-only hooks and helpers (kept out of the shared lib on purpose). */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormatter } from 'next-intl';
import { merchant } from '@/lib/api/services';
import { isApiError } from '@/lib/api/errors';

export const mqk = {
  payment: (id: string) => ['merchant', 'payment', id] as const,
  settlement: (id: string) => ['merchant', 'settlement', id] as const,
  qr: (id: string) => ['merchant', 'qr', id] as const,
};

export function isNotFound(e: unknown) {
  return isApiError(e) && (e.code === 'NOT_FOUND' || e.status === 404);
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const useMerchantPayment = (id: string | null) =>
  useQuery({ queryKey: mqk.payment(id ?? ''), queryFn: () => merchant.payment(id!), enabled: Boolean(id) });

export const useSettlementDetail = (id: string | null) =>
  useQuery({ queryKey: mqk.settlement(id ?? ''), queryFn: () => merchant.settlement(id!), enabled: Boolean(id) });

/** Polls a dynamic QR every 2 s until it is PAID or EXPIRED. */
export const useDynamicQrStatus = (qrId: string | null) =>
  useQuery({
    queryKey: mqk.qr(qrId ?? ''),
    queryFn: () => merchant.qrStatus(qrId!),
    enabled: Boolean(qrId),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'ACTIVE' ? false : 2000),
    refetchIntervalInBackground: true,
  });

/** Consistent date formatting across merchant screens. */
export function useDates() {
  const format = useFormatter();
  return React.useMemo(
    () => ({
      dateTime: (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }),
      date: (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' }),
      short: (iso: string) => format.dateTime(new Date(iso), { month: 'short', day: 'numeric' }),
    }),
    [format],
  );
}

/** "m:ss" for a countdown in seconds. */
export function formatClock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
