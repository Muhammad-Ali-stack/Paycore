import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Currency, Merchant, Payment, QrCode, QrKind } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PartyDto } from '../../common/dto/common.dto';
import { DomainError } from '../../common/errors/domain-error';
import { moneyView } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { addSeconds } from '../../common/util/time';
import { AppConfig } from '../../config/app-config';
import { parseKeyList } from '../../config/env';
import { PinService } from '../auth/pin.service';
import { FeeRuleValues, computeFee } from '../fees/fee.policy';
import { FeesService } from '../fees/fees.service';
import { LimitsService } from '../kyc/limits.service';
import { LedgerService } from '../ledger/ledger.service';
import { LegInput, credit, debit } from '../ledger/ledger.validation';
import { mdrFor } from '../merchants/merchant.math';
import { MoneyPlan, PaymentEngine, operationHash } from '../payments/payment-engine.service';
import { userParty } from '../payments/parties';
import { TransfersService } from '../transfers/transfers.service';
import { externalRefFor } from '../wallets/payments.service';
import { WalletsService, toMinor } from '../wallets/wallets.service';
import { DynamicQrDto, PayQrDto, QrPreviewDto, ReceiveQrDto } from './qr.dto';
import { PreviewClaims, QrSigner } from './qr.signer';

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

export function effectiveQrStatus(qr: Pick<QrCode, 'status' | 'expiresAt'>, now = new Date()): QrCode['status'] {
  return qr.status === 'ACTIVE' && qr.expiresAt && qr.expiresAt <= now ? 'EXPIRED' : qr.status;
}

export function dynamicQrView(qr: QrCode): DynamicQrDto {
  return {
    qrId: qr.id,
    payload: qr.payload,
    amount: moneyView(qr.amount ?? 0n, qr.currency),
    expiresAt: (qr.expiresAt ?? new Date(0)).toISOString(),
    status: effectiveQrStatus(qr),
    paymentId: qr.paymentId,
    reference: qr.reference,
  };
}

/**
 * QR payments. Flow: scan -> POST /qr/resolve (verify HMAC, load the code, price it, return a
 * signed preview token) -> POST /qr/pay (verify preview, PIN, pay through the payment engine).
 *
 * Anti-tampering: payloads are HMAC-signed; the DB row (looked up by the signed id) must match
 * the signed kind/currency/amount. Anti-replay: preview tokens are single use (partial UNIQUE
 * index on payments.preview_jti) and bound to the payer. Double-pay: single-use codes are
 * claimed ACTIVE->PAID inside the money transaction AND payments.single_use_qr_id is UNIQUE.
 */
@Injectable()
export class QrService {
  readonly signer: QrSigner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly fees: FeesService,
    private readonly pins: PinService,
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
    private readonly limits: LimitsService,
    private readonly transfers: TransfersService,
    private readonly engine: PaymentEngine,
    @InjectPinoLogger(QrService.name) private readonly logger: PinoLogger,
  ) {
    const previous = config.get('QR_SIGNING_PREVIOUS_KEYS');
    this.signer = new QrSigner(
      { kid: config.get('QR_SIGNING_KEY_ID'), secret: config.get('QR_SIGNING_SECRET') },
      previous ? parseKeyList(previous) : [],
    );
  }

  // ─────────────────────────── issuing ───────────────────────────

  async createCode(
    input: {
      kind: QrKind;
      currency: Currency;
      amount?: bigint | null;
      merchantId?: string | null;
      outletId?: string | null;
      terminalId?: string | null;
      userId?: string | null;
      reference?: string | null;
      expiresAt?: Date | null;
      singleUse: boolean;
    },
    tx: Tx = this.prisma,
  ): Promise<QrCode> {
    const id = randomUUID();
    const payload = this.signer.signPayload({
      qid: id,
      kind: input.kind,
      currency: input.currency,
      amountMinor: input.amount ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    this.logger.info({ qrId: id, kind: input.kind, merchantId: input.merchantId, singleUse: input.singleUse }, 'QR code issued');
    return tx.qrCode.create({
      data: {
        id,
        kind: input.kind,
        currency: input.currency,
        amount: input.amount ?? null,
        merchantId: input.merchantId ?? null,
        outletId: input.outletId ?? null,
        terminalId: input.terminalId ?? null,
        userId: input.userId ?? null,
        reference: input.reference ?? null,
        expiresAt: input.expiresAt ?? null,
        singleUse: input.singleUse,
        keyId: this.config.get('QR_SIGNING_KEY_ID'),
        payload,
      },
    });
  }

  /** Consumer "My QR". With an amount it is single use and expires; without, it is reusable. */
  async createReceive(userId: string, dto: { currency: Currency; amount?: string }): Promise<ReceiveQrDto> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId_currency: { userId, currency: dto.currency } } });
    if (!wallet || wallet.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', `Open an active ${dto.currency} wallet first`);
    const amount = dto.amount ? toMinor(dto.amount, dto.currency) : null;
    const qr = await this.createCode({
      kind: 'P2P_RECEIVE',
      currency: dto.currency,
      amount,
      userId,
      singleUse: amount !== null,
      expiresAt: amount !== null ? addSeconds(new Date(), this.config.get('QR_P2P_TTL_SECONDS')) : null,
    });
    return { qrId: qr.id, payload: qr.payload, expiresAt: qr.expiresAt?.toISOString() ?? null };
  }

  // ─────────────────────────── resolve ───────────────────────────

  /** Verify a scanned payload and load its row; any mismatch with the signed claims = tampering. */
  private async load(payload: string): Promise<QrCode> {
    const claims = this.signer.verifyPayload(payload);
    const qr = await this.prisma.qrCode.findUnique({ where: { id: claims.qid } });
    const signedAmount = claims.amt ?? null;
    if (
      !qr ||
      qr.kind !== claims.kind ||
      qr.currency !== claims.cur ||
      (qr.amount === null ? null : qr.amount.toString()) !== signedAmount
    ) {
      throw new DomainError('QR_INVALID', 'This QR code is not a valid PayCore code');
    }
    return qr;
  }

  private assertPayable(qr: QrCode, now = new Date()): void {
    const status = effectiveQrStatus(qr, now);
    if (status === 'PAID') throw new DomainError('QR_ALREADY_PAID', 'This QR code has already been paid');
    if (status === 'EXPIRED') throw new DomainError('QR_EXPIRED', 'This QR code has expired');
    if (status !== 'ACTIVE') throw new DomainError('QR_NOT_ACTIVE', 'This QR code is no longer active');
  }

  private async payee(qr: QrCode, payerId: string): Promise<{ party: PartyDto; payeeRef: string; merchant: Merchant | null }> {
    if (qr.kind === 'P2P_RECEIVE') {
      if (qr.userId === payerId) throw new DomainError('SELF_TRANSFER', 'You cannot pay your own QR code');
      const user = await this.prisma.user.findUnique({ where: { id: qr.userId ?? '' } });
      if (!user || user.status !== 'ACTIVE') throw new DomainError('QR_NOT_ACTIVE', 'This QR code is no longer active');
      return { party: userParty(user), payeeRef: `user:${user.id}`, merchant: null };
    }
    const merchant = await this.prisma.merchant.findUnique({ where: { id: qr.merchantId ?? '' } });
    if (!merchant || merchant.status !== 'ACTIVE') throw new DomainError('MERCHANT_NOT_ACTIVE', 'This merchant cannot accept payments right now');
    if (merchant.ownerUserId === payerId) throw new DomainError('SELF_TRANSFER', 'You cannot pay your own merchant');
    const outlet = qr.outletId ? await this.prisma.merchantOutlet.findUnique({ where: { id: qr.outletId } }) : null;
    if (outlet && outlet.status !== 'ACTIVE') throw new DomainError('QR_NOT_ACTIVE', 'This outlet is not accepting payments');
    return {
      party: {
        type: 'MERCHANT',
        displayName: merchant.businessName,
        merchantId: merchant.id,
        ...(outlet ? { outletName: outlet.name } : {}),
      },
      payeeRef: `merchant:${merchant.id}`,
      merchant,
    };
  }

  async resolve(userId: string, payload: string): Promise<QrPreviewDto> {
    const qr = await this.load(payload);
    const now = new Date();
    this.assertPayable(qr, now);
    const { party, payeeRef } = await this.payee(qr, userId);
    const rule = await this.fees.rule(qr.kind === 'P2P_RECEIVE' ? 'QR_P2P' : 'QR_MERCHANT', qr.currency);

    let previewExpires = addSeconds(now, this.config.get('QR_PREVIEW_TTL_SECONDS'));
    if (qr.expiresAt && qr.expiresAt < previewExpires) previewExpires = qr.expiresAt;
    const previewToken = this.signer.signPreview({
      jti: randomUUID(),
      qid: qr.id,
      sub: userId,
      kind: qr.kind,
      payee: payeeRef,
      cur: qr.currency,
      amt: qr.amount?.toString() ?? null,
      fee: { bps: rule.bps, fixed: rule.fixed.toString(), min: rule.min.toString(), max: rule.max?.toString() ?? null },
      iat: unix(now),
      exp: unix(previewExpires),
    });
    return {
      previewToken,
      kind: qr.kind,
      payee: party,
      amount: qr.amount === null ? null : moneyView(qr.amount, qr.currency),
      currency: qr.currency,
      fee: qr.amount === null ? null : moneyView(computeFee(rule, qr.amount), qr.currency),
      expiresAt: qr.expiresAt?.toISOString() ?? null,
      previewExpiresAt: previewExpires.toISOString(),
    };
  }

  // ─────────────────────────── pay ───────────────────────────

  async pay(userId: string, dto: PayQrDto, idempotencyKey: string): Promise<Payment> {
    const claims = this.signer.verifyPreview(dto.previewToken);
    if (claims.sub !== userId) throw new DomainError('QR_PREVIEW_INVALID', 'Invalid payment preview; scan the code again');

    const externalRef = externalRefFor(userId, idempotencyKey);
    const requestHash = operationHash('qr.pay', { jti: claims.jti, fromWalletId: dto.fromWalletId, amount: dto.amount ?? null });
    const prior = await this.engine.findByExternalRef(externalRef);
    const replay = prior ? this.engine.replayOrNull(prior, requestHash) : null;
    if (replay) return replay;

    const qr = await this.prisma.qrCode.findUnique({ where: { id: claims.qid } });
    if (!qr || qr.kind !== claims.kind || qr.currency !== claims.cur) {
      throw new DomainError('QR_PREVIEW_INVALID', 'Invalid payment preview; scan the code again');
    }
    if (!prior) this.assertPayable(qr);
    const { payeeRef, merchant } = await this.payee(qr, userId);
    if (payeeRef !== claims.payee) throw new DomainError('QR_PREVIEW_INVALID', 'The payee changed; scan the code again');

    const amount = this.amountFor(claims, dto.amount);
    const source = await this.wallets.getOwned(userId, dto.fromWalletId);
    if (source.currency !== qr.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `This code must be paid from a ${qr.currency} wallet`);
    }
    const rule: FeeRuleValues = {
      bps: claims.fee.bps,
      fixed: BigInt(claims.fee.fixed),
      min: BigInt(claims.fee.min),
      max: claims.fee.max === null ? null : BigInt(claims.fee.max),
    };
    const fee = computeFee(rule, amount);
    await this.pins.verify(userId, dto.pin);

    const common = {
      externalRef,
      requestHash,
      payerUserId: userId,
      payerWalletId: source.id,
      qrCodeId: qr.id,
      currency: qr.currency,
      amount,
      fee,
      reference: qr.reference,
      previewJti: claims.jti,
    };
    const claimQr = (tx: Tx, paymentId: string) => (qr.singleUse ? this.claimSingleUse(tx, qr.id, paymentId) : Promise.resolve());

    if (merchant) {
      const mdr = mdrFor(amount, merchant.mdrBps);
      return this.engine.execute(
        {
          ...common,
          type: 'QR_MERCHANT',
          merchantId: merchant.id,
          outletId: qr.outletId,
          terminalId: qr.terminalId,
          mdrFee: mdr,
        },
        (payment) => this.merchantPlan(payment, source, merchant, qr, claimQr),
      );
    }

    const target = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId: qr.userId as string, currency: qr.currency } },
    });
    if (!target) throw new DomainError('QR_NOT_ACTIVE', 'This QR code is no longer active');
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', qr.currency);
    return this.engine.execute({ ...common, type: 'QR_P2P', payeeUserId: qr.userId, payeeWalletId: target.id }, (payment) => {
      const legs: LegInput[] = [debit(source.ledgerAccountId, payment.amount + payment.fee), credit(target.ledgerAccountId, payment.amount)];
      if (payment.fee > 0n) legs.push(credit(feeRevenue, payment.fee));
      return {
        lockAccountIds: payment.fee > 0n ? [source.ledgerAccountId, target.ledgerAccountId, feeRevenue] : [source.ledgerAccountId, target.ledgerAccountId],
        activeWalletIds: [source.id, target.id],
        entryType: 'PAYMENT',
        description: 'QR payment',
        legs,
        metadata: { qrId: qr.id, fromWalletId: source.id, toWalletId: target.id, currency: qr.currency },
        singleUseQrId: qr.singleUse ? qr.id : null,
        validate: async (tx, locked) => {
          await claimQr(tx, payment.id);
          await this.transfers.checkP2PLimits(tx, locked, {
            senderId: userId,
            recipientId: qr.userId as string,
            sourceAccount: source.ledgerAccountId,
            targetAccount: target.ledgerAccountId,
            fromCurrency: qr.currency,
            toCurrency: qr.currency,
            debit: payment.amount + payment.fee,
            credit: payment.amount,
          });
        },
      };
    });
  }

  /**
   * Merchant payment. DR payer wallet (amount + payer fee) | CR merchant payable (amount - MDR)
   * | CR fee revenue (MDR + payer fee). Fee revenue is locked only when something is charged.
   */
  private async merchantPlan(
    payment: Payment,
    source: { id: string; ledgerAccountId: string },
    merchant: Merchant,
    qr: QrCode,
    claimQr: (tx: Tx, paymentId: string) => Promise<void>,
  ): Promise<MoneyPlan> {
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', payment.currency);
    const revenue = payment.mdrFee + payment.fee;
    const legs: LegInput[] = [debit(source.ledgerAccountId, payment.amount + payment.fee)];
    if (payment.amount - payment.mdrFee > 0n) legs.push(credit(merchant.ledgerAccountId, payment.amount - payment.mdrFee));
    if (revenue > 0n) legs.push(credit(feeRevenue, revenue));
    return {
      lockAccountIds: revenue > 0n ? [source.ledgerAccountId, merchant.ledgerAccountId, feeRevenue] : [source.ledgerAccountId, merchant.ledgerAccountId],
      activeWalletIds: [source.id],
      entryType: 'PAYMENT',
      description: `Payment to ${merchant.businessName}`,
      legs,
      metadata: {
        qrId: qr.id,
        merchantId: merchant.id,
        outletId: qr.outletId,
        fromWalletId: source.id,
        currency: payment.currency,
        mdr: payment.mdrFee.toString(),
      },
      singleUseQrId: qr.singleUse ? qr.id : null,
      validate: async (tx) => {
        const m = await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id }, select: { status: true } });
        if (m.status !== 'ACTIVE') throw new DomainError('MERCHANT_NOT_ACTIVE', 'This merchant cannot accept payments right now');
        await claimQr(tx, payment.id);
        const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: payment.payerUserId as string }, select: { kycTier: true } });
        await this.limits.assertOutflow(tx, {
          tier: kycTier,
          currency: payment.currency,
          accountId: source.ledgerAccountId,
          amount: payment.amount + payment.fee,
        });
      },
    };
  }

  private amountFor(claims: PreviewClaims, input: string | undefined): bigint {
    const currency = claims.cur as Currency;
    if (claims.amt !== null) {
      const bound = BigInt(claims.amt);
      if (input !== undefined && toMinor(input, currency) !== bound) {
        throw new DomainError('VALIDATION_FAILED', 'amount does not match the QR code amount');
      }
      return bound;
    }
    if (input === undefined) throw new DomainError('VALIDATION_FAILED', 'amount is required for this QR code');
    return toMinor(input, currency);
  }

  /** ACTIVE -> PAID inside the payment transaction (compare-and-set; rolled back with the payment). */
  private async claimSingleUse(tx: Tx, qrId: string, paymentId: string): Promise<void> {
    const now = new Date();
    const res = await tx.qrCode.updateMany({
      where: { id: qrId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: 'PAID', paymentId },
    });
    if (res.count === 1) return;
    const qr = await tx.qrCode.findUniqueOrThrow({ where: { id: qrId } });
    this.assertPayable(qr, now);
    throw new DomainError('QR_NOT_ACTIVE', 'This QR code is no longer active');
  }

  /** ACTIVE single-use codes past their expiry -> EXPIRED (housekeeping job). */
  async expireCodes(now = new Date()): Promise<number> {
    const { count } = await this.prisma.qrCode.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}
