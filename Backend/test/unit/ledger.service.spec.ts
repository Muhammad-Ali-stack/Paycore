import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { LockedAccount } from '../../src/modules/ledger/ledger.types';
import { credit, debit } from '../../src/modules/ledger/ledger.validation';

/** Minimal fake transaction client capturing what the ledger writes. */
function fakeTx(accounts: LockedAccount[]) {
  const writes = { entries: [] as unknown[], postings: [] as Array<Record<string, unknown>>, updates: [] as unknown[] };
  const lockedIds: string[][] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = { strings, values };
      const ids: string[] = JSON.stringify(sql).match(/[a-z0-9-]{3,}/g) ?? [];
      const rows = accounts.filter((a) => ids.includes(a.id)).sort((x, y) => x.id.localeCompare(y.id));
      lockedIds.push(rows.map((r) => r.id));
      return rows;
    }),
    journalEntry: { create: jest.fn(async ({ data }) => (writes.entries.push(data), { id: 'entry-1', ...data })) },
    posting: {
      createManyAndReturn: jest.fn(async ({ data }) => (writes.postings.push(...data), data)),
    },
    ledgerAccount: { updateMany: jest.fn(async (args) => (writes.updates.push(args), { count: 1 })) },
  };
  return { tx, writes, lockedIds };
}

const logger = { info: jest.fn(), warn: jest.fn() };
const service = new LedgerService({} as never, logger as never);

const wallet = (id: string, balance: bigint): LockedAccount => ({
  id,
  currency: 'PKR',
  normalBalance: 'CREDIT',
  allowNegative: false,
  balance,
  version: 3,
});
const clearing: LockedAccount = { id: 'sys-bank', currency: 'PKR', normalBalance: 'DEBIT', allowNegative: true, balance: 0n, version: 0 };

describe('LedgerService.post', () => {
  it('posts a balanced entry, computes balanceAfter, and bumps versions', async () => {
    const { tx, writes } = fakeTx([wallet('wal-a', 1000n), wallet('wal-b', 0n)]);
    await service.post(tx as never, {
      type: 'TRANSFER',
      description: 't',
      legs: [debit('wal-a', 400n), credit('wal-b', 400n)],
    });
    expect(writes.postings).toEqual([
      expect.objectContaining({ accountId: 'wal-a', amount: 400n, balanceAfter: 600n }),
      expect.objectContaining({ accountId: 'wal-b', amount: -400n, balanceAfter: 400n }),
    ]);
    expect(writes.updates).toEqual(
      expect.arrayContaining([
        { where: { id: 'wal-a', version: 3 }, data: { balance: 600n, version: { increment: 1 } } },
        { where: { id: 'wal-b', version: 3 }, data: { balance: 400n, version: { increment: 1 } } },
      ]),
    );
  });

  it('rejects overdrafts on non-negative accounts without writing anything', async () => {
    const { tx, writes } = fakeTx([wallet('wal-a', 100n), wallet('wal-b', 0n)]);
    await expect(
      service.post(tx as never, { type: 'TRANSFER', description: 't', legs: [debit('wal-a', 101n), credit('wal-b', 101n)] }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(writes.entries).toHaveLength(0);
  });

  it('allows system accounts flagged allowNegative to go negative', async () => {
    const { tx } = fakeTx([clearing, wallet('wal-a', 0n)]);
    await expect(
      service.post(tx as never, { type: 'WITHDRAWAL', description: 'w', legs: [debit('wal-a', 0n + 1n), credit('sys-bank', 1n)] }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' }); // wallet can't
    const second = fakeTx([clearing, wallet('wal-a', 0n)]);
    await expect(
      service.post(second.tx as never, { type: 'DEPOSIT', description: 'd', legs: [debit('sys-bank', 5n), credit('wal-a', 5n)] }),
    ).resolves.toBeDefined();
  });

  it('rejects unbalanced entries', async () => {
    const { tx } = fakeTx([wallet('wal-a', 1000n), wallet('wal-b', 0n)]);
    await expect(
      service.post(tx as never, {
        type: 'ADJUSTMENT',
        description: 'bad',
        legs: [
          { accountId: 'wal-a', amount: 10n },
          { accountId: 'wal-b', amount: -9n },
        ],
      }),
    ).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
  });

  it('locks accounts in ascending id order regardless of leg order', async () => {
    const { tx, lockedIds } = fakeTx([wallet('zzz-1', 1000n), wallet('aaa-2', 0n)]);
    await service.post(tx as never, { type: 'TRANSFER', description: 't', legs: [debit('zzz-1', 1n), credit('aaa-2', 1n)] });
    expect(lockedIds[0]).toEqual(['aaa-2', 'zzz-1']);
  });

  it('detects an optimistic version conflict', async () => {
    const { tx } = fakeTx([wallet('wal-a', 1000n), wallet('wal-b', 0n)]);
    tx.ledgerAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.post(tx as never, { type: 'TRANSFER', description: 't', legs: [debit('wal-a', 1n), credit('wal-b', 1n)] }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });
});
