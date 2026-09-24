'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRight, Info, Search as SearchIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/states/states';
import { useAdminSearch, useMe, useQueryClient } from '@/lib/api/hooks';
import { admin } from '@/lib/api/services';
import type { AdminUser } from '@/lib/api/contracts/phase1';
import type {
  AdminTransaction,
  AdminWalletSummary,
  ApprovalAction,
  CreateApprovalBody,
} from '@/lib/api/contracts/future';
import { shortId } from '@/lib/utils';
import {
  Masked,
  NoteDialog,
  RiskBadge,
  SectionHeading,
  Td,
  Th,
  useDateTime,
  useDebounced,
} from '@/features/admin/shared';

type PendingRequest = {
  action: ApprovalAction;
  targetType: CreateApprovalBody['targetType'];
  targetId: string;
  targetLabel: string;
  payload: Record<string, unknown>;
};

function useTierLabel() {
  const t = useTranslations('kyc.tiers');
  return (k: string) => (t.has(k as 'TIER_0') ? t(k as 'TIER_0') : k);
}
function useTxType() {
  const t = useTranslations('tx.types');
  return (k: string) => (t.has(k as 'P2P') ? t(k as 'P2P') : k);
}

function UsersSection({
  users,
  onRequest,
  meId,
}: {
  users: AdminUser[];
  onRequest: (r: PendingRequest) => void;
  meId?: string;
}) {
  const t = useTranslations();
  const tier = useTierLabel();
  const action = (u: AdminUser) => {
    if (u.id === meId) return null;
    const suspended = u.status === 'SUSPENDED';
    const a: ApprovalAction = suspended ? 'USER_REACTIVATE' : 'USER_SUSPEND';
    return (
      <Button
        size="sm"
        variant={suspended ? 'secondary' : 'danger'}
        onClick={() =>
          onRequest({
            action: a,
            targetType: 'USER',
            targetId: u.id,
            targetLabel: u.fullName,
            payload: { status: suspended ? 'ACTIVE' : 'SUSPENDED' },
          })
        }
      >
        {suspended ? t('admin.reactivate') : t('admin.suspend')}
        <span className="sr-only">: {u.fullName}</span>
      </Button>
    );
  };
  return (
    <section aria-labelledby="sr-users">
      <SectionHeading id="sr-users" count={users.length}>
        {t('admin.users')}
      </SectionHeading>
      {users.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('admin.noResults')}</p>
      ) : (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('admin.users')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('admin.search.name')}</Th>
                  <Th>{t('admin.phone')}</Th>
                  <Th>{t('admin.search.role')}</Th>
                  <Th>{t('admin.search.tier')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th className="text-end">
                    <span className="sr-only">{t('admin.search.actionsCol')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <Td>
                      <span className="block font-medium">{u.fullName}</span>
                      {u.username ? <span className="block text-xs text-fg-muted">@{u.username}</span> : null}
                    </Td>
                    <Td>
                      <Masked value={u.phone} label={t('admin.phone')} />
                    </Td>
                    <Td>
                      <Badge tone={u.role === 'ADMIN' ? 'accent' : 'neutral'}>{t(`admin.roles.${u.role}`)}</Badge>
                    </Td>
                    <Td>{tier(u.kycTier)}</Td>
                    <Td>
                      <StatusBadge status={u.status} />
                    </Td>
                    <Td className="text-end">{action(u)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ul className="grid gap-2 md:hidden">
            {users.map((u) => (
              <li key={u.id} className="grid gap-2 rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{u.fullName}</p>
                    <Masked value={u.phone} label={t('admin.phone')} className="text-xs text-fg-muted" />
                  </div>
                  <StatusBadge status={u.status} />
                </div>
                <p className="text-xs text-fg-muted">
                  {t(`admin.roles.${u.role}`)} · {tier(u.kycTier)}
                </p>
                <div className="flex justify-end">{action(u)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WalletsSection({
  wallets,
  onRequest,
}: {
  wallets: AdminWalletSummary[];
  onRequest: (r: PendingRequest) => void;
}) {
  const t = useTranslations();
  const action = (w: AdminWalletSummary) => {
    if (w.status === 'CLOSED') return null;
    const frozen = w.status === 'FROZEN';
    const label = `${w.owner.displayName} · ${w.currency}`;
    return (
      <Button
        size="sm"
        variant={frozen ? 'secondary' : 'danger'}
        onClick={() =>
          onRequest({
            action: frozen ? 'WALLET_UNFREEZE' : 'WALLET_FREEZE',
            targetType: 'WALLET',
            targetId: w.id,
            targetLabel: label,
            payload: { status: frozen ? 'ACTIVE' : 'FROZEN' },
          })
        }
      >
        {frozen ? t('admin.unfreeze') : t('admin.freeze')}
        <span className="sr-only">: {label}</span>
      </Button>
    );
  };
  return (
    <section aria-labelledby="sr-wallets">
      <SectionHeading id="sr-wallets" count={wallets.length}>
        {t('admin.wallets')}
      </SectionHeading>
      {wallets.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('admin.noResults')}</p>
      ) : (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('admin.wallets')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('admin.search.owner')}</Th>
                  <Th>{t('common.currency')}</Th>
                  <Th className="text-end">{t('admin.search.balance')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('common.id')}</Th>
                  <Th className="text-end">
                    <span className="sr-only">{t('admin.search.actionsCol')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id} className="border-b border-border/60 last:border-0">
                    <Td>
                      <span className="block font-medium">{w.owner.displayName}</span>
                      <span className="code block text-xs text-fg-muted" dir="ltr">
                        {w.owner.phoneMasked}
                      </span>
                    </Td>
                    <Td>{w.currency}</Td>
                    <Td className="text-end">
                      <Amount money={w.balance} />
                    </Td>
                    <Td>
                      <StatusBadge status={w.status} />
                    </Td>
                    <Td>
                      <span className="code text-xs" title={w.id}>
                        {shortId(w.id)}
                      </span>
                    </Td>
                    <Td className="text-end">{action(w)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ul className="grid gap-2 md:hidden">
            {wallets.map((w) => (
              <li key={w.id} className="grid gap-2 rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{w.owner.displayName}</p>
                    <p className="code text-xs text-fg-muted" dir="ltr">
                      {w.owner.phoneMasked}
                    </p>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Amount money={w.balance} className="font-medium" />
                  {action(w)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TransactionsSection({ txs }: { txs: AdminTransaction[] }) {
  const t = useTranslations();
  const dt = useDateTime();
  const type = useTxType();
  return (
    <section aria-labelledby="sr-txs">
      <SectionHeading id="sr-txs" count={txs.length}>
        {t('admin.transactions')}
      </SectionHeading>
      {txs.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('admin.noResults')}</p>
      ) : (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('admin.transactions')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('admin.search.type')}</Th>
                  <Th>{t('admin.search.parties')}</Th>
                  <Th className="text-end">{t('common.amount')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('admin.risk')}</Th>
                </tr>
              </thead>
              <tbody>
                {txs.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <Td className="whitespace-nowrap text-fg-muted">
                      <span className="block">{dt(p.createdAt)}</span>
                      <span className="code text-xs" title={p.id}>
                        {shortId(p.id)}
                      </span>
                    </Td>
                    <Td>{type(p.type)}</Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <span>{p.payer.displayName}</span>
                        <ArrowRight className="size-3.5 text-fg-muted rtl:rotate-180" aria-label={t('common.to')} />
                        <span>{p.payee.displayName}</span>
                      </span>
                    </Td>
                    <Td className="text-end">
                      <Amount money={p.amount} />
                    </Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td>
                      <RiskBadge score={p.riskScore} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ul className="grid gap-2 md:hidden">
            {txs.map((p) => (
              <li key={p.id} className="grid gap-1.5 rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm text-fg">
                    {p.payer.displayName}{' '}
                    <span aria-hidden className="inline-block text-fg-muted rtl:rotate-180">
                      →
                    </span>
                    <span className="sr-only">{t('common.to')}</span> {p.payee.displayName}
                  </p>
                  <Amount money={p.amount} className="font-medium" />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span>{type(p.type)}</span>
                  <span>·</span>
                  <span>{dt(p.createdAt)}</span>
                  <StatusBadge status={p.status} />
                  <RiskBadge score={p.riskScore} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SearchInner() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const [text, setText] = React.useState(() => params.get('q') ?? '');
  const debounced = useDebounced(text.trim(), 350);
  const query = useAdminSearch(debounced);
  const [request, setRequest] = React.useState<PendingRequest | null>(null);
  const ready = debounced.length >= 2;

  // Keep ?q= in sync so searches are linkable (never contains more than what was typed).
  React.useEffect(() => {
    const current = params.get('q') ?? '';
    if (current === debounced) return;
    const sp = new URLSearchParams(params.toString());
    if (debounced) sp.set('q', debounced);
    else sp.delete('q');
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  }, [debounced, params, pathname, router]);

  const total = query.data ? query.data.users.length + query.data.wallets.length + query.data.transactions.length : 0;

  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin.searchTitle')} description={t('admin.search.subtitle')} />

      <form role="search" onSubmit={(e) => e.preventDefault()} className="grid gap-2">
        <label htmlFor="admin-search" className="sr-only">
          {t('admin.searchTitle')}
        </label>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <Input
            id="admin-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('admin.searchPlaceholder')}
            className="ps-9"
            autoComplete="off"
            aria-describedby="admin-search-hint"
          />
        </div>
        <p id="admin-search-hint" className="text-xs text-fg-muted">
          {t('admin.search.minChars')}
        </p>
      </form>

      <p className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-tint px-3 py-2 text-sm text-accent-text">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('admin.makerCheckerHint')}
      </p>

      <div aria-live="polite" className="sr-only">
        {ready && query.data ? t('admin.resultsCount', { count: total }) : ''}
      </div>

      {!ready ? (
        <EmptyState title={t('admin.search.startTitle')} body={t('admin.search.startBody')} />
      ) : query.isPending ? (
        <ListSkeleton rows={6} label={t('states.loadingList')} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : total === 0 ? (
        <EmptyState title={t('admin.noResults')} body={t('admin.search.noResultsBody', { q: debounced })} />
      ) : (
        <div className="grid gap-8">
          <UsersSection users={query.data.users} onRequest={setRequest} meId={me.data?.id} />
          <WalletsSection wallets={query.data.wallets} onRequest={setRequest} />
          <TransactionsSection txs={query.data.transactions} />
        </div>
      )}

      <NoteDialog
        open={Boolean(request)}
        onOpenChange={(o) => !o && setRequest(null)}
        title={request ? t('admin.requestAction', { action: t(`admin.actions.${request.action}`) }) : ''}
        description={request ? `${request.targetLabel}. ${t('admin.makerCheckerHint')}` : undefined}
        label={t('common.reason')}
        placeholder={t('admin.search.reasonPlaceholder')}
        minLength={5}
        tone={request?.action === 'WALLET_FREEZE' || request?.action === 'USER_SUSPEND' ? 'danger' : 'primary'}
        confirmLabel={t('admin.search.submitRequest')}
        onSubmit={async (reason) => {
          const r = request!;
          await admin.requestApproval({
            action: r.action,
            targetType: r.targetType,
            targetId: r.targetId,
            reason,
            payload: r.payload,
          });
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['admin', 'approvals'] }),
            qc.invalidateQueries({ queryKey: ['admin', 'audit'] }),
          ]);
          toast.success(t('admin.requested'));
        }}
      />
    </div>
  );
}

export default function AdminSearchPage() {
  const t = useTranslations('states');
  return (
    <React.Suspense fallback={<ListSkeleton rows={6} label={t('loadingPage')} />}>
      <SearchInner />
    </React.Suspense>
  );
}
