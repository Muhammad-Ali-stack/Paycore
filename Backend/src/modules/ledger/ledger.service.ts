import { Injectable } from '@nestjs/common';
import { Currency, LedgerAccount, Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import {
  CreateAccountInput,
  LockedAccount,
  PostEntryInput,
  PostedEntry,
  SystemAccountKind,
  systemAccountCode,
} from './ledger.types';
import { applyPosting, assertBalanced, assertWellFormed, normalBalanceFor, ResolvedLeg } from './ledger.validation';

export interface IntegrityReport {
  healthy: boolean;
  unbalancedEntries: Array<{ entryId: string; currency: Currency; net: string }>;
  netByCurrency: Array<{ currency: Currency; net: string; postings: string }>;
  balanceCacheMismatches: Array<{ accountId: string; cached: string; derived: string }>;
  trialBalance: Array<{ currency: Currency; debitNormal: string; creditNormal: string }>;
}

/**
 * The double-entry ledger. The only code allowed to write journal entries and postings.
 *
 * Invariants (enforced here AND by DB constraints/triggers):
 *  - amounts are integer minor units; every entry nets to zero per currency;
 *  - journal entries and postings are append-only; corrections are reversal entries;
 *  - cached account balances are updated in the same transaction as the postings,
 *    guarded by row locks (acquired in ascending id order) and an optimistic version.
 */
@Injectable()
export class LedgerService {
  private readonly systemAccountIds = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(LedgerService.name) private readonly logger: PinoLogger,
  ) {}

  // ─────────────────────────── accounts ───────────────────────────

  async createAccount(tx: Tx, input: CreateAccountInput): Promise<LedgerAccount> {
    return tx.ledgerAccount.create({
      data: {
        name: input.name,
        code: input.code ?? null,
        type: input.type,
        normalBalance: normalBalanceFor(input.type),
        ownerType: input.ownerType,
        currency: input.currency,
        allowNegative: input.allowNegative ?? false,
      },
    });
  }

  async systemAccountId(kind: SystemAccountKind, currency: Currency): Promise<string> {
    const code = systemAccountCode(kind, currency);
    const cached = this.systemAccountIds.get(code);
    if (cached) return cached;
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code }, select: { id: true } });
    if (!account) throw new Error(`System account ${code} is missing; run migrations`);
    this.systemAccountIds.set(code, account.id);
    return account.id;
  }

  async listSystemAccounts(): Promise<LedgerAccount[]> {
    return this.prisma.ledgerAccount.findMany({ where: { ownerType: 'SYSTEM' }, orderBy: { code: 'asc' } });
  }

  async getAccount(id: string): Promise<LedgerAccount> {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    if (!account) throw new DomainError('NOT_FOUND', 'Ledger account not found');
    return account;
  }

  /**
   * Lock accounts with SELECT ... FOR UPDATE. Locks are always taken in ascending id order,
   * in a single statement, so two transactions touching overlapping accounts can never
   * deadlock on each other (A->B and B->A both lock min(A,B) first).
   */
  async lockAccounts(tx: Tx, accountIds: readonly string[]): Promise<Map<string, LockedAccount>> {
    const ids = [...new Set(accountIds)].sort();
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedAccount[]>`
      SELECT id,
             currency::text        AS "currency",
             normal_balance::text  AS "normalBalance",
             allow_negative        AS "allowNegative",
             balance,
             version
        FROM ledger_accounts
       WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
       ORDER BY id
         FOR UPDATE`;
    if (rows.length !== ids.length) throw new DomainError('NOT_FOUND', 'One or more ledger accounts do not exist');
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ─────────────────────────── posting ───────────────────────────

  /**
   * Post a balanced journal entry inside the caller's transaction. Callers that need to
   * validate against balances (limits, wallet state) should call `lockAccounts` with the
   * full account set first; re-locking here is then a no-op.
   */
  async post(tx: Tx, input: PostEntryInput): Promise<PostedEntry> {
    assertWellFormed(input.legs);
    const accounts = await this.lockAccounts(
      tx,
      input.legs.map((l) => l.accountId),
    );

    const legs: ResolvedLeg[] = input.legs.map((leg) => ({
      ...leg,
      currency: (accounts.get(leg.accountId) as LockedAccount).currency,
    }));
    assertBalanced(legs);

    // Compute running balances (an account may appear in more than one leg).
    const running = new Map<string, bigint>([...accounts.values()].map((a) => [a.id, a.balance]));
    const postingRows = legs.map((leg) => {
      const account = accounts.get(leg.accountId) as LockedAccount;
      const after = applyPosting(running.get(leg.accountId) as bigint, account.normalBalance, leg.amount);
      running.set(leg.accountId, after);
      return { accountId: leg.accountId, currency: leg.currency, amount: leg.amount, balanceAfter: after };
    });

    for (const account of accounts.values()) {
      const finalBalance = running.get(account.id) as bigint;
      if (!account.allowNegative && finalBalance < 0n) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'Insufficient funds', { accountId: account.id });
      }
    }

    const entry = await tx.journalEntry.create({
      data: {
        type: input.type,
        description: input.description,
        externalRef: input.externalRef ?? null,
        reversalOfId: input.reversalOfId ?? null,
        initiatedBy: input.initiatedBy ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const postings = await tx.posting.createManyAndReturn({
      data: postingRows.map((p) => ({ ...p, entryId: entry.id })),
    });

    for (const account of accounts.values()) {
      const finalBalance = running.get(account.id) as bigint;
      const updated = await tx.ledgerAccount.updateMany({
        where: { id: account.id, version: account.version },
        data: { balance: finalBalance, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        // Cannot happen while we hold the row lock; guards against code paths that bypass it.
        throw new DomainError('CONCURRENT_MODIFICATION', 'Ledger account was modified concurrently');
      }
    }

    this.logger.info(
      { entryId: entry.id, type: entry.type, legs: postingRows.length, externalRef: input.externalRef },
      'Journal entry posted',
    );
    return { entry, postings };
  }

  /** Fetch an entry by its external reference (used when an idempotent retry races a commit). */
  async findByExternalRef(externalRef: string): Promise<PostedEntry | null> {
    const entry = await this.prisma.journalEntry.findUnique({ where: { externalRef }, include: { postings: true } });
    if (!entry) return null;
    const { postings, ...rest } = entry;
    return { entry: rest, postings };
  }

  async getEntry(id: string): Promise<PostedEntry> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { postings: { orderBy: { amount: 'desc' } } },
    });
    if (!entry) throw new DomainError('NOT_FOUND', 'Journal entry not found');
    const { postings, ...rest } = entry;
    return { entry: rest, postings };
  }

  /**
   * Reverse an entry by posting its exact mirror image. The original is never touched.
   * `reversal_of_id` is unique, so an entry can be reversed at most once even under races.
   */
  async reverse(entryId: string, opts: { actorId: string; reason: string; externalRef?: string }): Promise<PostedEntry> {
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const original = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { postings: true } });
        if (!original) throw new DomainError('NOT_FOUND', 'Journal entry not found');
        const { postings, ...entry } = original;
        return this.reverseInTx(tx, { entry, postings }, opts);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'reversal_of_id')) {
        throw new DomainError('ENTRY_ALREADY_REVERSED', 'Entry has already been reversed');
      }
      throw err;
    }
  }

  /**
   * Post the mirror image of `original` inside the caller's transaction (compensating reversal).
   * Money flows call `lockAccounts` over the entry's accounts first, so this runs after the locks.
   * A concurrent second reversal fails on the UNIQUE reversal_of_id.
   */
  async reverseInTx(
    tx: Tx,
    original: PostedEntry,
    opts: { actorId?: string | null; reason: string; externalRef?: string; metadata?: Record<string, unknown> },
  ): Promise<PostedEntry> {
    if (original.entry.type === 'REVERSAL') {
      throw new DomainError('LEDGER_INVALID_ENTRY', 'A reversal entry cannot itself be reversed');
    }
    const already = await tx.journalEntry.findUnique({ where: { reversalOfId: original.entry.id }, select: { id: true } });
    if (already) throw new DomainError('ENTRY_ALREADY_REVERSED', 'Entry has already been reversed');
    return this.post(tx, {
      type: 'REVERSAL',
      description: `Reversal of ${original.entry.id}: ${opts.reason}`,
      reversalOfId: original.entry.id,
      initiatedBy: opts.actorId ?? undefined,
      externalRef: opts.externalRef,
      metadata: { ...(opts.metadata ?? {}), reason: opts.reason, reversedEntryType: original.entry.type },
      legs: original.postings.map((p) => ({ accountId: p.accountId, amount: -p.amount })),
    });
  }

  /** Accounts touched by an entry (to lock before reversing it). */
  async entryAccountIds(entryId: string): Promise<string[]> {
    const rows = await this.prisma.posting.findMany({ where: { entryId }, select: { accountId: true } });
    return [...new Set(rows.map((r) => r.accountId))];
  }

  // ─────────────────────────── verification ───────────────────────────

  /** Balance recomputed from postings (the source of truth), on the account's normal side. */
  async derivedBalance(accountId: string): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<Array<{ derived: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN a.normal_balance = 'DEBIT' THEN p.amount ELSE -p.amount END), 0)::bigint AS derived
        FROM ledger_accounts a
        LEFT JOIN postings p ON p.account_id = a.id
       WHERE a.id = ${accountId}::uuid
       GROUP BY a.id`;
    if (!row) throw new DomainError('NOT_FOUND', 'Ledger account not found');
    return row.derived;
  }

  /** Full-book verification. Suitable for a nightly job and for tests. */
  async integrityReport(): Promise<IntegrityReport> {
    const unbalanced = await this.prisma.$queryRaw<Array<{ entryId: string; currency: Currency; net: bigint }>>`
      SELECT entry_id AS "entryId", currency::text AS currency, SUM(amount)::bigint AS net
        FROM postings GROUP BY entry_id, currency HAVING SUM(amount) <> 0 LIMIT 100`;
    const net = await this.prisma.$queryRaw<Array<{ currency: Currency; net: bigint; postings: bigint }>>`
      SELECT currency::text AS currency, SUM(amount)::bigint AS net, COUNT(*)::bigint AS postings
        FROM postings GROUP BY currency ORDER BY currency`;
    const mismatches = await this.prisma.$queryRaw<Array<{ accountId: string; cached: bigint; derived: bigint }>>`
      SELECT a.id AS "accountId", a.balance AS cached,
             COALESCE(SUM(CASE WHEN a.normal_balance = 'DEBIT' THEN p.amount ELSE -p.amount END), 0)::bigint AS derived
        FROM ledger_accounts a LEFT JOIN postings p ON p.account_id = a.id
       GROUP BY a.id
      HAVING a.balance <> COALESCE(SUM(CASE WHEN a.normal_balance = 'DEBIT' THEN p.amount ELSE -p.amount END), 0)
       LIMIT 100`;
    const trial = await this.prisma.$queryRaw<Array<{ currency: Currency; debitNormal: bigint; creditNormal: bigint }>>`
      SELECT currency::text AS currency,
             COALESCE(SUM(CASE WHEN normal_balance = 'DEBIT'  THEN balance ELSE 0 END), 0)::bigint AS "debitNormal",
             COALESCE(SUM(CASE WHEN normal_balance = 'CREDIT' THEN balance ELSE 0 END), 0)::bigint AS "creditNormal"
        FROM ledger_accounts GROUP BY currency ORDER BY currency`;

    const healthy =
      unbalanced.length === 0 &&
      mismatches.length === 0 &&
      net.every((n) => n.net === 0n) &&
      trial.every((t) => t.debitNormal === t.creditNormal);

    return {
      healthy,
      unbalancedEntries: unbalanced.map((u) => ({ ...u, net: u.net.toString() })),
      netByCurrency: net.map((n) => ({ currency: n.currency, net: n.net.toString(), postings: n.postings.toString() })),
      balanceCacheMismatches: mismatches.map((m) => ({
        accountId: m.accountId,
        cached: m.cached.toString(),
        derived: m.derived.toString(),
      })),
      trialBalance: trial.map((t) => ({
        currency: t.currency,
        debitNormal: t.debitNormal.toString(),
        creditNormal: t.creditNormal.toString(),
      })),
    };
  }
}
