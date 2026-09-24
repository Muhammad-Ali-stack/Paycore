import { Injectable } from '@nestjs/common';
import { Currency, Merchant, MerchantOutlet, MerchantStatus, Payment, Prisma, QrCode } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { moneyView } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addSeconds, startOfUtcDay } from '../../common/util/time';
import { AppConfig } from '../../config/app-config';
import { LedgerService } from '../ledger/ledger.service';
import { QrService } from '../qr/qr.service';
import { settlementView } from '../settlement/settlement.mapper';
import { toMinor } from '../wallets/wallets.service';
import {
  AdminMerchantsQuery,
  CreateDynamicQrDto,
  CreateMerchantDto,
  CreateOutletDto,
  MerchantDashboardDto,
  MerchantDto,
  MerchantPageDto,
  MerchantPaymentsQuery,
  OutletDto,
  TerminalDto,
} from './merchants.dto';
import { merchantMachine } from './merchant.state';

export function merchantView(m: Merchant): MerchantDto {
  return {
    id: m.id,
    businessName: m.businessName,
    category: m.category,
    status: m.status,
    kybTier: m.kybTier,
    settlementCurrency: m.settlementCurrency,
    settlementDelayDays: m.settlementDelayDays,
    mdrBps: m.mdrBps,
    createdAt: m.createdAt.toISOString(),
  };
}

export function outletView(o: MerchantOutlet, qr: QrCode | undefined): OutletDto {
  return {
    id: o.id,
    name: o.name,
    address: o.address,
    status: o.status,
    staticQr: { qrId: qr?.id ?? '', payload: qr?.payload ?? '' },
    createdAt: o.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Merchant onboarding (KYB), outlets/terminals, dynamic QR, payment history and dashboard. */
@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly qr: QrService,
    private readonly config: AppConfig,
    @InjectPinoLogger(MerchantsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Creates the merchant (PENDING_REVIEW, KYB_0) and its payable ledger account atomically. */
  async onboard(ownerUserId: string, dto: CreateMerchantDto): Promise<Merchant> {
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const account = await this.ledger.createAccount(tx, {
          name: `Merchant payable ${dto.settlementCurrency} / ${dto.businessName}`.slice(0, 190),
          type: 'LIABILITY',
          ownerType: 'MERCHANT',
          currency: dto.settlementCurrency,
          allowNegative: false,
        });
        return tx.merchant.create({
          data: {
            ownerUserId,
            businessName: dto.businessName,
            category: dto.category,
            registrationNumber: dto.registrationNumber,
            website: dto.website ?? null,
            settlementCurrency: dto.settlementCurrency,
            settlementBank: { ...dto.settlementBank },
            settlementDelayDays: this.config.get('MERCHANT_DEFAULT_SETTLEMENT_DELAY_DAYS'),
            mdrBps: this.config.get('MERCHANT_DEFAULT_MDR_BPS'),
            ledgerAccountId: account.id,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'owner_user_id')) throw new DomainError('MERCHANT_EXISTS', 'You already have a merchant account');
      throw err;
    }
  }

  async mine(ownerUserId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUnique({ where: { ownerUserId } });
    if (!merchant) throw new DomainError('NOT_FOUND', 'No merchant account; onboard with POST /merchants first');
    return merchant;
  }

  async getById(id: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) throw new DomainError('NOT_FOUND', 'Merchant not found');
    return merchant;
  }

  private assertActive(m: Merchant): void {
    if (m.status !== 'ACTIVE') throw new DomainError('MERCHANT_NOT_ACTIVE', `Merchant is ${m.status.toLowerCase().replace('_', ' ')}`);
  }

  // ─────────────────────────── admin ───────────────────────────

  async list(q: AdminMerchantsQuery): Promise<MerchantPageDto> {
    const take = q.limit ?? 25;
    const rows = await this.prisma.merchant.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    return { items: page.map(merchantView), nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null };
  }

  async setStatus(id: string, to: MerchantStatus, actorId: string): Promise<Merchant> {
    const current = await this.getById(id);
    merchantMachine.assert(current.status, to);
    const res = await this.prisma.merchant.updateMany({
      where: { id, status: current.status },
      data: {
        status: to,
        ...(to === 'ACTIVE' ? { kybTier: current.kybTier === 'KYB_0' ? 'KYB_1' : current.kybTier, approvedAt: current.approvedAt ?? new Date() } : {}),
      },
    });
    if (res.count !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'Merchant changed concurrently; retry');
    this.logger.warn({ merchantId: id, from: current.status, to, actorId }, 'Merchant status changed');
    return this.getById(id);
  }

  async setPricing(id: string, mdrBps: number, settlementDelayDays: number, actorId: string): Promise<Merchant> {
    await this.getById(id);
    const updated = await this.prisma.merchant.update({ where: { id }, data: { mdrBps, settlementDelayDays } });
    this.logger.warn({ merchantId: id, mdrBps, settlementDelayDays, actorId }, 'Merchant pricing changed');
    return updated;
  }

  // ─────────────────────────── outlets / terminals ───────────────────────────

  async outlets(ownerUserId: string): Promise<OutletDto[]> {
    const merchant = await this.mine(ownerUserId);
    const outlets = await this.prisma.merchantOutlet.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'asc' } });
    const qrs = await this.prisma.qrCode.findMany({ where: { id: { in: outlets.map((o) => o.staticQrId ?? '').filter(Boolean) } } });
    const byId = new Map(qrs.map((q) => [q.id, q]));
    return outlets.map((o) => outletView(o, byId.get(o.staticQrId ?? '')));
  }

  /** Every outlet gets a reusable, signed static QR (payer enters the amount). */
  async createOutlet(ownerUserId: string, dto: CreateOutletDto): Promise<OutletDto> {
    const merchant = await this.mine(ownerUserId);
    return this.prisma.runInTransaction(async (tx) => {
      const outlet = await tx.merchantOutlet.create({ data: { merchantId: merchant.id, name: dto.name, address: dto.address ?? null } });
      const qr = await this.qr.createCode(
        { kind: 'STATIC_MERCHANT', currency: merchant.settlementCurrency, merchantId: merchant.id, outletId: outlet.id, singleUse: false },
        tx,
      );
      const updated = await tx.merchantOutlet.update({ where: { id: outlet.id }, data: { staticQrId: qr.id } });
      return outletView(updated, qr);
    });
  }

  private async ownedOutlet(merchantId: string, outletId: string): Promise<MerchantOutlet> {
    const outlet = await this.prisma.merchantOutlet.findUnique({ where: { id: outletId } });
    if (!outlet || outlet.merchantId !== merchantId) throw new DomainError('NOT_FOUND', 'Outlet not found');
    return outlet;
  }

  async terminals(ownerUserId: string, outletId: string): Promise<TerminalDto[]> {
    const merchant = await this.mine(ownerUserId);
    await this.ownedOutlet(merchant.id, outletId);
    const rows = await this.prisma.merchantTerminal.findMany({ where: { outletId }, orderBy: { createdAt: 'asc' } });
    return rows.map((t) => ({ id: t.id, label: t.label, status: t.status, createdAt: t.createdAt.toISOString() }));
  }

  async createTerminal(ownerUserId: string, outletId: string, label: string): Promise<TerminalDto> {
    const merchant = await this.mine(ownerUserId);
    await this.ownedOutlet(merchant.id, outletId);
    const t = await this.prisma.merchantTerminal.create({ data: { outletId, merchantId: merchant.id, label } });
    return { id: t.id, label: t.label, status: t.status, createdAt: t.createdAt.toISOString() };
  }

  // ─────────────────────────── dynamic QR ───────────────────────────

  /** Single-use, amount-bound, expiring QR for a checkout (cashier screen polls GET /merchant/qr/:id). */
  async createDynamicQr(ownerUserId: string, dto: CreateDynamicQrDto): Promise<QrCode> {
    const merchant = await this.mine(ownerUserId);
    this.assertActive(merchant);
    if (dto.currency !== merchant.settlementCurrency) {
      throw new DomainError('CURRENCY_MISMATCH', `This merchant accepts ${merchant.settlementCurrency} only`);
    }
    let outletId = dto.outletId ?? null;
    if (dto.terminalId) {
      const terminal = await this.prisma.merchantTerminal.findUnique({ where: { id: dto.terminalId } });
      if (!terminal || terminal.merchantId !== merchant.id) throw new DomainError('NOT_FOUND', 'Terminal not found');
      if (terminal.status !== 'ACTIVE') throw new DomainError('QR_NOT_ACTIVE', 'Terminal is disabled');
      if (outletId && outletId !== terminal.outletId) throw new DomainError('VALIDATION_FAILED', 'terminalId does not belong to outletId');
      outletId = terminal.outletId;
    }
    if (outletId) {
      const outlet = await this.ownedOutlet(merchant.id, outletId);
      if (outlet.status !== 'ACTIVE') throw new DomainError('QR_NOT_ACTIVE', 'Outlet is disabled');
    }
    return this.qr.createCode({
      kind: 'DYNAMIC_MERCHANT',
      currency: dto.currency,
      amount: toMinor(dto.amount, dto.currency),
      merchantId: merchant.id,
      outletId,
      terminalId: dto.terminalId ?? null,
      reference: dto.reference ?? null,
      expiresAt: addSeconds(new Date(), dto.expiresInSeconds),
      singleUse: true,
    });
  }

  async getQr(ownerUserId: string, qrId: string): Promise<QrCode> {
    const merchant = await this.mine(ownerUserId);
    const qr = await this.prisma.qrCode.findUnique({ where: { id: qrId } });
    if (!qr || qr.merchantId !== merchant.id || qr.kind !== 'DYNAMIC_MERCHANT') throw new DomainError('NOT_FOUND', 'QR code not found');
    return qr;
  }

  // ─────────────────────────── payments ───────────────────────────

  async payments(ownerUserId: string, q: MerchantPaymentsQuery): Promise<{ items: Payment[]; nextCursor: string | null }> {
    const merchant = await this.mine(ownerUserId);
    const take = q.limit ?? 25;
    const where: Prisma.PaymentWhereInput = {
      merchantId: merchant.id,
      type: 'QR_MERCHANT',
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      ...(q.q
        ? { OR: [{ reference: { contains: q.q, mode: 'insensitive' } }, ...(UUID.test(q.q) ? [{ id: q.q }] : [])] }
        : {}),
    };
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    return { items: page, nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null };
  }

  async payment(ownerUserId: string, paymentId: string): Promise<Payment> {
    const merchant = await this.mine(ownerUserId);
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.merchantId !== merchant.id || payment.type !== 'QR_MERCHANT') {
      throw new DomainError('NOT_FOUND', 'Payment not found');
    }
    return payment;
  }

  // ─────────────────────────── dashboard ───────────────────────────

  async dashboard(ownerUserId: string, currency?: Currency): Promise<MerchantDashboardDto> {
    const merchant = await this.mine(ownerUserId);
    if (currency && currency !== merchant.settlementCurrency) {
      throw new DomainError('CURRENCY_MISMATCH', `This merchant settles in ${merchant.settlementCurrency}`);
    }
    const ccy = merchant.settlementCurrency;
    const today = startOfUtcDay(new Date());
    const since = new Date(today.getTime() - 13 * 86_400_000);

    // Timestamps are stored as UTC wall time (timestamp without time zone); the ISO string cast to
    // ::timestamp keeps the comparison in UTC regardless of the session time zone.
    const series = await this.prisma.$queryRaw<Array<{ day: string; volume: bigint; count: bigint }>>`
      SELECT to_char(completed_at, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(amount), 0)::bigint AS volume, COUNT(*)::bigint AS count
        FROM payments
       WHERE merchant_id = ${merchant.id}::uuid AND type = 'QR_MERCHANT'
         AND status::text IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')
         AND completed_at >= ${since.toISOString()}::timestamp
       GROUP BY 1`;
    const byDay = new Map(series.map((r) => [r.day, r]));
    const points = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      const row = byDay.get(date);
      return { date, volume: moneyView(row?.volume ?? 0n, ccy), count: Number(row?.count ?? 0n) };
    });

    const todayPoint = points[points.length - 1] as (typeof points)[number];
    const refunds = await this.prisma.refund.aggregate({
      where: { merchantId: merchant.id, status: 'COMPLETED', completedAt: { gte: today } },
      _sum: { amount: true },
    });
    const account = await this.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: merchant.ledgerAccountId } });
    const last = await this.prisma.settlement.findFirst({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' } });
    return {
      today: { volume: todayPoint.volume, count: todayPoint.count, refunds: moneyView(refunds._sum.amount ?? 0n, ccy) },
      pendingSettlement: moneyView(account.balance, ccy),
      lastSettlement: last ? settlementView(last) : null,
      series: points,
    };
  }
}
