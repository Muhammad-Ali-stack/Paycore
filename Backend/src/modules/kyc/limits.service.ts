import { Injectable } from '@nestjs/common';
import { Currency, KycTier, TierLimit } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { formatAmount, moneyView } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { startOfUtcDay, startOfUtcMonth } from '../../common/util/time';
import { LimitViolation, OutflowUsage, checkInflow, checkOutflow } from './limits.policy';

export function limitView(l: TierLimit) {
  return {
    tier: l.tier,
    currency: l.currency,
    permitted: l.maxBalance > 0n,
    perTransaction: moneyView(l.perTxnMax, l.currency),
    daily: moneyView(l.dailyMax, l.currency),
    monthly: moneyView(l.monthlyMax, l.currency),
    maxBalance: moneyView(l.maxBalance, l.currency),
  };
}

/**
 * KYC limit enforcement. The assert* methods must run inside the money transaction AFTER the
 * wallet's ledger account row is locked; that serialises concurrent outflows on the same wallet
 * so they cannot jointly exceed a daily/monthly limit.
 */
@Injectable()
export class LimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLimit(tier: KycTier, currency: Currency, tx: Tx = this.prisma): Promise<TierLimit> {
    const limit = await tx.tierLimit.findUnique({ where: { tier_currency: { tier, currency } } });
    if (!limit) throw new Error(`Tier limit ${tier}/${currency} missing; run migrations`);
    return limit;
  }

  listLimits(tier?: KycTier): Promise<TierLimit[]> {
    return this.prisma.tierLimit.findMany({
      where: tier ? { tier } : undefined,
      orderBy: [{ tier: 'asc' }, { currency: 'asc' }],
    });
  }

  /** Sum of debits (outflows) on a wallet account in the current UTC day and month. */
  async outflowUsage(accountId: string, tx: Tx = this.prisma, now = new Date()): Promise<OutflowUsage> {
    const [row] = await tx.$queryRaw<Array<{ daily: bigint; monthly: bigint }>>`
      SELECT COALESCE(SUM(amount) FILTER (WHERE created_at >= ${startOfUtcDay(now)}), 0)::bigint AS daily,
             COALESCE(SUM(amount), 0)::bigint AS monthly
        FROM postings
       WHERE account_id = ${accountId}::uuid
         AND amount > 0
         AND created_at >= ${startOfUtcMonth(now)}`;
    return { daily: row?.daily ?? 0n, monthly: row?.monthly ?? 0n };
  }

  async assertOutflow(
    tx: Tx,
    p: { tier: KycTier; currency: Currency; accountId: string; amount: bigint },
  ): Promise<void> {
    const limit = await this.getLimit(p.tier, p.currency, tx);
    const usage = await this.outflowUsage(p.accountId, tx);
    this.raise(checkOutflow(limit, usage, p.amount), limit, p.currency, p.tier);
  }

  async assertInflow(
    tx: Tx,
    p: { tier: KycTier; currency: Currency; currentBalance: bigint; amount: bigint; enforcePerTxn: boolean },
  ): Promise<void> {
    const limit = await this.getLimit(p.tier, p.currency, tx);
    this.raise(
      checkInflow(limit, p.currentBalance, p.amount, { enforcePerTxn: p.enforcePerTxn }),
      limit,
      p.currency,
      p.tier,
    );
  }

  private raise(violation: LimitViolation | null, limit: TierLimit, currency: Currency, tier: KycTier): void {
    if (!violation) return;
    if (violation === 'CURRENCY_NOT_PERMITTED') {
      throw new DomainError('CURRENCY_NOT_PERMITTED', `${currency} is not available at KYC ${tier}`, { tier, currency });
    }
    const value = {
      PER_TRANSACTION: limit.perTxnMax,
      DAILY: limit.dailyMax,
      MONTHLY: limit.monthlyMax,
      MAX_BALANCE: limit.maxBalance,
    }[violation];
    throw new DomainError('LIMIT_EXCEEDED', `${violation.toLowerCase().replace('_', ' ')} limit exceeded`, {
      limit: violation,
      tier,
      currency,
      value: formatAmount(value, currency),
    });
  }
}
