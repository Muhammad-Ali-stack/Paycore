import { Currency, ReconciliationItemType } from '@prisma/client';

export interface NetLine {
  reference: string;
  currency: Currency;
  /** signed minor units: + money into PayCore's bank account, - money out */
  amount: bigint;
}

export interface DiffItem {
  type: ReconciliationItemType;
  reference: string;
  currency: Currency;
  bankAmount: bigint | null;
  ledgerAmount: bigint | null;
}

export interface DiffResult {
  matched: number;
  items: DiffItem[];
}

const keyOf = (l: { reference: string; currency: Currency }) => `${l.reference}|${l.currency}`;

function net(lines: readonly NetLine[]): Map<string, NetLine> {
  const out = new Map<string, NetLine>();
  for (const l of lines) {
    const k = keyOf(l);
    const prev = out.get(k);
    out.set(k, { reference: l.reference, currency: l.currency, amount: (prev?.amount ?? 0n) + l.amount });
  }
  return out;
}

/**
 * Compare the bank statement with the ledger's BANK_CLEARING movements for one business date,
 * netted per (reference, currency). A side that is absent counts as zero, so a movement and its
 * same-day reversal net out on both sides.
 *   bank != 0, ledger == 0  -> MISSING_IN_LEDGER   (bank moved money we have not booked)
 *   bank == 0, ledger != 0  -> MISSING_IN_BANK     (we booked money the bank did not move)
 *   both != 0 and differ    -> AMOUNT_MISMATCH
 *   equal                   -> matched
 */
export function diffStatement(bank: readonly NetLine[], ledger: readonly NetLine[]): DiffResult {
  const b = net(bank);
  const l = net(ledger);
  const keys = [...new Set([...b.keys(), ...l.keys()])].sort();
  let matched = 0;
  const items: DiffItem[] = [];
  for (const k of keys) {
    const bl = b.get(k);
    const ll = l.get(k);
    const ref = (bl ?? ll) as NetLine;
    const bankAmt = bl?.amount ?? 0n;
    const ledgerAmt = ll?.amount ?? 0n;
    if (bankAmt === ledgerAmt) {
      matched++;
      continue;
    }
    const type: ReconciliationItemType =
      ledgerAmt === 0n ? 'MISSING_IN_LEDGER' : bankAmt === 0n ? 'MISSING_IN_BANK' : 'AMOUNT_MISMATCH';
    items.push({
      type,
      reference: ref.reference,
      currency: ref.currency,
      bankAmount: bl ? bl.amount : null,
      ledgerAmount: ll ? ll.amount : null,
    });
  }
  return { matched, items };
}

/** The UTC business day [start, end) for YYYY-MM-DD. */
export function businessDay(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid business date ${date}`);
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) throw new Error(`Invalid business date ${date}`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export const utcDate = (d: Date): string => d.toISOString().slice(0, 10);
