import { Injectable } from '@nestjs/common';
import { Payment } from '@prisma/client';
import { PartyDto } from '../../common/dto/common.dto';
import { PrismaService } from '../../common/prisma/prisma.service';

/** "Ali Khan" -> "Ali K.", "Madonna" -> "Madonna". Never exposes the full surname. */
export function shortDisplayName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PayCore user';
  const first = words[0] as string;
  if (words.length === 1) return first;
  const last = words[words.length - 1] as string;
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/** "+923001234567" -> "+92300****567" (keeps the country/operator prefix and last 3 digits). */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return `${phone.slice(0, 2)}****`;
  return `${phone.slice(0, 6)}****${phone.slice(-3)}`;
}

export interface UserParty {
  id: string;
  fullName: string;
  username: string | null;
}

export function userParty(u: UserParty | undefined): PartyDto {
  if (!u) return { type: 'USER', displayName: 'PayCore user' };
  return { type: 'USER', displayName: shortDisplayName(u.fullName), ...(u.username ? { username: u.username } : {}) };
}

export interface PaymentParties {
  payer: PartyDto;
  payee: PartyDto;
}

/** Resolves payer/payee parties for a batch of payments with three queries (no N+1). */
@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async users(ids: string[]): Promise<Map<string, UserParty>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true, username: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  async forPayments(payments: Payment[]): Promise<Map<string, PaymentParties>> {
    const users = await this.users(payments.flatMap((p) => [p.payerUserId ?? '', p.payeeUserId ?? '']));
    const merchantIds = [...new Set(payments.map((p) => p.merchantId).filter((x): x is string => !!x))];
    const outletIds = [...new Set(payments.map((p) => p.outletId).filter((x): x is string => !!x))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, businessName: true } })
      : [];
    const outlets = outletIds.length
      ? await this.prisma.merchantOutlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : [];
    const merchantName = new Map(merchants.map((m) => [m.id, m.businessName]));
    const outletName = new Map(outlets.map((o) => [o.id, o.name]));

    const merchantParty = (p: Payment): PartyDto => ({
      type: 'MERCHANT',
      displayName: merchantName.get(p.merchantId ?? '') ?? 'Merchant',
      merchantId: p.merchantId ?? undefined,
      ...(p.outletId && outletName.has(p.outletId) ? { outletName: outletName.get(p.outletId) } : {}),
    });

    const result = new Map<string, PaymentParties>();
    for (const p of payments) {
      const payerUser = userParty(users.get(p.payerUserId ?? ''));
      const payeeUser = userParty(users.get(p.payeeUserId ?? ''));
      if (p.type === 'QR_MERCHANT') result.set(p.id, { payer: payerUser, payee: merchantParty(p) });
      else if (p.type === 'REFUND') result.set(p.id, { payer: merchantParty(p), payee: payeeUser });
      else result.set(p.id, { payer: payerUser, payee: payeeUser });
    }
    return result;
  }
}
