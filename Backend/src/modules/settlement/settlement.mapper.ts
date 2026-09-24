import { Settlement, SettlementLine } from '@prisma/client';
import { moneyView } from '../../common/money/money';
import { SettlementDto } from '../merchants/merchants.dto';

export function settlementView(s: Settlement, lines?: SettlementLine[]): SettlementDto {
  return {
    id: s.id,
    currency: s.currency,
    periodStart: s.periodStart.toISOString(),
    periodEnd: s.periodEnd.toISOString(),
    gross: moneyView(s.gross, s.currency),
    mdr: moneyView(s.mdr, s.currency),
    refunds: moneyView(s.refunds, s.currency),
    net: moneyView(s.net, s.currency),
    status: s.status,
    paidAt: s.paidAt?.toISOString() ?? null,
    bankReference: s.bankReference,
    ...(lines
      ? {
          lines: lines.map((l) => ({
            kind: l.kind,
            paymentId: l.paymentId,
            refundId: l.refundId,
            gross: moneyView(l.gross, s.currency),
            mdr: moneyView(l.mdr, s.currency),
            net: moneyView(l.net, s.currency),
            occurredAt: l.occurredAt.toISOString(),
          })),
        }
      : {}),
  };
}

const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
export const csvRow = (cells: Array<string | number | null | undefined>): string =>
  cells.map((c) => csvCell(c === null || c === undefined ? '' : String(c))).join(',');

/** Settlement report: a summary header block followed by one line per payment/refund. */
export function settlementReportCsv(s: Settlement, lines: SettlementLine[], merchantName: string): string {
  const v = settlementView(s, lines);
  const out = [
    csvRow(['Settlement report', merchantName]),
    csvRow(['Settlement id', v.id]),
    csvRow(['Period start', v.periodStart]),
    csvRow(['Period end', v.periodEnd]),
    csvRow(['Currency', v.currency]),
    csvRow(['Gross', v.gross.amount]),
    csvRow(['MDR', v.mdr.amount]),
    csvRow(['Refunds', v.refunds.amount]),
    csvRow(['Net', v.net.amount]),
    csvRow(['Status', v.status]),
    csvRow(['Bank reference', v.bankReference]),
    csvRow(['Paid at', v.paidAt]),
    '',
    csvRow(['kind', 'payment_id', 'refund_id', 'occurred_at', 'gross', 'mdr', 'net']),
    ...(v.lines ?? []).map((l) => csvRow([l.kind, l.paymentId, l.refundId, l.occurredAt, l.gross.amount, l.mdr.amount, l.net.amount])),
  ];
  return `${out.join('\r\n')}\r\n`;
}
