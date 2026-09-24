'use client';

/** TanStack Query hooks. Query keys are centralised in `qk`. */
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Currency, PageQuery } from './contracts/common';
import type { ActivityQuery, Merchant, PaymentStatus } from './contracts/phase2';
import {
  activity,
  admin,
  analytics,
  auth,
  bills,
  cards,
  funding,
  kyc,
  merchant,
  paymentRequests,
  users,
  wallets,
} from './services';

export const qk = {
  session: ['session'] as const,
  me: ['me'] as const,
  wallets: ['wallets'] as const,
  kyc: ['kyc', 'me'] as const,
  tiers: ['kyc', 'tiers'] as const,
  prefs: ['prefs'] as const,
  notificationPrefs: ['prefs', 'notifications'] as const,
  contacts: ['contacts'] as const,
  sessions: ['sessions'] as const,
  activity: (q: ActivityQuery) => ['activity', q] as const,
  requests: (direction: 'INCOMING' | 'OUTGOING') => ['requests', direction] as const,
  funding: (id: string) => ['funding', id] as const,
  fundingList: ['funding', 'list'] as const,
  cards: ['cards'] as const,
  cardTxns: (id: string) => ['cards', id, 'txns'] as const,
  billers: (category?: string, q?: string) => ['billers', category ?? 'ALL', q ?? ''] as const,
  billPayments: ['bills', 'payments'] as const,
  schedules: ['bills', 'schedules'] as const,
  spending: (c: Currency, groupBy: string, from: string) => ['analytics', 'spending', c, groupBy, from] as const,
  trend: (c: Currency, g: string, periods: number) => ['analytics', 'trend', c, g, periods] as const,
  currencies: ['analytics', 'currencies'] as const,
  merchant: ['merchant', 'me'] as const,
  merchantDashboard: (c?: string) => ['merchant', 'dashboard', c ?? 'default'] as const,
  merchantPayments: (q: object) => ['merchant', 'payments', q] as const,
  merchantRefunds: ['merchant', 'refunds'] as const,
  settlements: ['merchant', 'settlements'] as const,
  outlets: ['merchant', 'outlets'] as const,
  terminals: (id: string) => ['merchant', 'outlets', id, 'terminals'] as const,
  apiKeys: ['merchant', 'api-keys'] as const,
  webhooks: ['merchant', 'webhooks'] as const,
  deliveries: (id: string) => ['merchant', 'webhooks', id, 'deliveries'] as const,
  admin: {
    kyc: (s: string) => ['admin', 'kyc', s] as const,
    fraud: (q: object) => ['admin', 'fraud', q] as const,
    fraudCase: (id: string) => ['admin', 'fraud', 'case', id] as const,
    approvals: (s: string) => ['admin', 'approvals', s] as const,
    audit: (q: object) => ['admin', 'audit', q] as const,
    search: (q: string) => ['admin', 'search', q] as const,
    merchants: (s?: string) => ['admin', 'merchants', s ?? 'ALL'] as const,
    users: (q: string) => ['admin', 'users', q] as const,
  },
};

/** After any money movement: balances, activity, analytics and limits are stale. */
export function invalidateMoney(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.wallets }),
    qc.invalidateQueries({ queryKey: ['activity'] }),
    qc.invalidateQueries({ queryKey: ['analytics'] }),
    qc.invalidateQueries({ queryKey: qk.kyc }),
    qc.invalidateQueries({ queryKey: ['requests'] }),
    qc.invalidateQueries({ queryKey: qk.contacts }),
  ]);
}

const PAGE = 20;

export const useSession = () => useQuery({ queryKey: qk.session, queryFn: auth.session, staleTime: 60_000 });
export const useMe = () => useQuery({ queryKey: qk.me, queryFn: users.me, staleTime: 60_000 });
export const useWallets = () => useQuery({ queryKey: qk.wallets, queryFn: wallets.list });
export const useKyc = () => useQuery({ queryKey: qk.kyc, queryFn: kyc.me });
export const useTiers = () => useQuery({ queryKey: qk.tiers, queryFn: kyc.tiers, staleTime: 3600_000 });
export const usePrefs = () => useQuery({ queryKey: qk.prefs, queryFn: users.preferences, staleTime: 300_000 });
export const useNotificationPrefs = () =>
  useQuery({ queryKey: qk.notificationPrefs, queryFn: users.notificationPrefs });
export const useRecentContacts = () => useQuery({ queryKey: qk.contacts, queryFn: users.recentContacts });
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: auth.sessions });
export const useCurrencies = () => useQuery({ queryKey: qk.currencies, queryFn: analytics.currencies });

export function useActivity(q: Omit<ActivityQuery, 'cursor'> = {}) {
  return useInfiniteQuery({
    queryKey: qk.activity(q),
    queryFn: ({ pageParam }) => activity.list({ ...q, limit: q.limit ?? PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useRequests(direction: 'INCOMING' | 'OUTGOING') {
  return useQuery({ queryKey: qk.requests(direction), queryFn: () => paymentRequests.list({ direction, limit: 50 }) });
}

export function useFunding(id: string) {
  return useQuery({
    queryKey: qk.funding(id),
    queryFn: () => funding.get(id),
    // Poll while the bank hasn't answered; stop once terminal.
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 1500 : false),
  });
}
export const useFundingList = () => useQuery({ queryKey: qk.fundingList, queryFn: () => funding.list({ limit: 10 }) });

export const useCards = () => useQuery({ queryKey: qk.cards, queryFn: cards.list });
export function useCardTxns(id: string) {
  return useInfiniteQuery({
    queryKey: qk.cardTxns(id),
    queryFn: ({ pageParam }) => cards.transactions(id, { limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(id),
  });
}

export const useBillers = (category?: string, q?: string) =>
  useQuery({
    queryKey: qk.billers(category, q),
    queryFn: () => bills.billers({ category, q: q || undefined }),
    staleTime: 300_000,
  });
export const useBillPayments = () =>
  useQuery({ queryKey: qk.billPayments, queryFn: () => bills.payments({ limit: 20 }) });
export const useSchedules = () => useQuery({ queryKey: qk.schedules, queryFn: bills.schedules });

export const useSpending = (currency: Currency, groupBy: 'CATEGORY' | 'MERCHANT', from: string) =>
  useQuery({
    queryKey: qk.spending(currency, groupBy, from),
    queryFn: () => analytics.spending({ currency, groupBy, from }),
  });
export const useTrend = (currency: Currency, granularity: 'DAY' | 'MONTH', periods: number) =>
  useQuery({
    queryKey: qk.trend(currency, granularity, periods),
    queryFn: () => analytics.trend({ currency, granularity, periods }),
  });

/* -------------------------------- Merchant ------------------------------- */

export const useMerchant = () => useQuery({ queryKey: qk.merchant, queryFn: merchant.me, retry: false });
export const useMerchantDashboard = (currency?: Currency) =>
  useQuery({
    queryKey: qk.merchantDashboard(currency),
    queryFn: () => merchant.dashboard(currency),
    refetchInterval: 30_000,
  });
export function useMerchantPayments(q: { status?: string; q?: string }) {
  const query = { q: q.q, status: q.status as PaymentStatus | undefined };
  return useInfiniteQuery({
    queryKey: qk.merchantPayments(q),
    queryFn: ({ pageParam }) => merchant.payments({ ...query, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
export const useMerchantRefunds = () =>
  useQuery({ queryKey: qk.merchantRefunds, queryFn: () => merchant.refunds({ limit: 50 }) });
export const useSettlements = () =>
  useQuery({ queryKey: qk.settlements, queryFn: () => merchant.settlements({ limit: 30 }) });
export const useOutlets = () => useQuery({ queryKey: qk.outlets, queryFn: merchant.outlets });
export const useTerminals = (id: string) =>
  useQuery({ queryKey: qk.terminals(id), queryFn: () => merchant.terminals(id), enabled: Boolean(id) });
export const useApiKeys = () => useQuery({ queryKey: qk.apiKeys, queryFn: merchant.apiKeys });
export const useWebhooks = () => useQuery({ queryKey: qk.webhooks, queryFn: merchant.webhooks });
export const useDeliveries = (id: string) =>
  useQuery({
    queryKey: qk.deliveries(id),
    queryFn: () => merchant.webhookDeliveries(id, { limit: 10 }),
    enabled: Boolean(id),
  });

/* ---------------------------------- Admin -------------------------------- */

export const useKycQueue = (status: 'PENDING' | 'APPROVED' | 'REJECTED' | string = 'PENDING') =>
  useQuery({ queryKey: qk.admin.kyc(status), queryFn: () => admin.kycQueue(status as 'PENDING') });
export const useFraudCases = (q: { status?: string; severity?: string }) =>
  useQuery({ queryKey: qk.admin.fraud(q), queryFn: () => admin.fraudCases({ ...q, limit: 50 }) });
export const useFraudCase = (id: string | null) =>
  useQuery({ queryKey: qk.admin.fraudCase(id ?? ''), queryFn: () => admin.fraudCase(id!), enabled: Boolean(id) });
export const useApprovals = (status: string) =>
  useQuery({
    queryKey: qk.admin.approvals(status),
    queryFn: () => admin.approvals({ status: status === 'ALL' ? undefined : status, limit: 50 }),
  });
export function useAudit(q: { q?: string; action?: string }) {
  return useInfiniteQuery({
    queryKey: qk.admin.audit(q),
    queryFn: ({ pageParam }) =>
      admin.audit({ ...q, limit: 25, cursor: pageParam ?? undefined } as PageQuery & typeof q),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
export const useAdminSearch = (q: string) =>
  useQuery({ queryKey: qk.admin.search(q), queryFn: () => admin.search(q), enabled: q.trim().length >= 2 });
export const useAdminMerchants = (status?: string) =>
  useQuery({
    queryKey: qk.admin.merchants(status),
    queryFn: () => admin.merchants({ status: status as Merchant['status'] | undefined, limit: 100 }),
  });

export { useQueryClient };
