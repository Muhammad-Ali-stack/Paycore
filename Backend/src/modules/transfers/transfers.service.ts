import { Injectable } from '@nestjs/common';
import { Currency, Payment, TransferQuote, User, Wallet } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { moneyView } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { addSeconds } from '../../common/util/time';
import { AppConfig } from '../../config/app-config';
import { PinService } from '../auth/pin.service';
import { FeeProduct } from '../fees/fee.policy';
import { FeesService } from '../fees/fees.service';
import { LimitsService } from '../kyc/limits.service';
import { LedgerService } from '../ledger/ledger.service';
import { LockedAccount } from '../ledger/ledger.types';
import { LegInput, credit, debit } from '../ledger/ledger.validation';
import { MoneyPlan, PaymentEngine, operationHash } from '../payments/payment-engine.service';
import { shortDisplayName } from '../payments/parties';
import { RecipientRef, UsersService } from '../users/users.service';
import { applySpread, convertMinor, formatRate, sendForReceive } from '../wallets/fx/fx.math';
import { RatesService } from '../wallets/fx/rates.service';
import { externalRefFor } from '../wallets/payments.service';
import { WalletsService, toMinor } from '../wallets/wallets.service';
import { CreateTransferDto, CreateTransferQuoteDto, TransferQuoteDto } from './transfers.dto';

export function transferQuoteView(q: TransferQuote, recipient: Pick<User, 'fullName' | 'username'>): TransferQuoteDto {
  return {
    id: q.id,
    send: moneyView(q.sendAmount, q.fromCurrency),
    receive: moneyView(q.receiveAmount, q.toCurrency),
    fee: moneyView(q.fee, q.fromCurrency),
    totalDebit: moneyView(q.sendAmount + q.fee, q.fromCurrency),
    fx: q.midRate !== null && q.customerRate !== null ? { midRate: formatRate(q.midRate), customerRate: formatRate(q.customerRate) } : null,
    recipient: { displayName: shortDisplayName(recipient.fullName), username: recipient.username },
    expiresAt: q.expiresAt.toISOString(),
  };
}

/** Ledger legs and lock set for a P2P payment (same- or cross-currency). Pure. */
export function p2pLegs(p: {
  sourceAccount: string;
  targetAccount: string;
  send: bigint;
  fee: bigint;
  receive: bigint;
  feeRevenue: string;
  fx: { settleFrom: string; settleTo: string } | null;
}): { legs: LegInput[]; lock: string[] } {
  const legs: LegInput[] = [debit(p.sourceAccount, p.send + p.fee)];
  const lock = [p.sourceAccount, p.targetAccount];
  if (p.fx) {
    legs.push(credit(p.fx.settleFrom, p.send), debit(p.fx.settleTo, p.receive), credit(p.targetAccount, p.receive));
    lock.push(p.fx.settleFrom, p.fx.settleTo);
  } else {
    legs.push(credit(p.targetAccount, p.send));
  }
  if (p.fee > 0n) {
    legs.push(credit(p.feeRevenue, p.fee));
    lock.push(p.feeRevenue); // hot row: only locked when a fee is charged
  }
  return { legs, lock };
}

/**
 * P2P transfers by phone or username, same- and cross-currency. Cross-currency transfers are
 * priced by a single-use quote (FX spread + P2P_FX fee), exactly like FX conversions, but the
 * target is the recipient's wallet.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly limits: LimitsService,
    private readonly pins: PinService,
    private readonly fees: FeesService,
    private readonly rates: RatesService,
    private readonly users: UsersService,
    private readonly engine: PaymentEngine,
    private readonly config: AppConfig,
    @InjectPinoLogger(TransfersService.name) private readonly logger: PinoLogger,
  ) {}

  async resolveRecipient(userId: string, ref: RecipientRef): Promise<User> {
    if (!!ref.phone === !!ref.username) {
      throw new DomainError('VALIDATION_FAILED', 'Provide exactly one of phone or username for the recipient');
    }
    const recipient = await this.users.findRecipient(ref);
    if (!recipient) throw new DomainError('NOT_FOUND', 'Recipient not found');
    if (recipient.id === userId) {
      throw new DomainError('SELF_TRANSFER', 'Use FX conversion to move money between your own wallets');
    }
    return recipient;
  }

  private async recipientWallet(recipientId: string, currency: Currency): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId_currency: { userId: recipientId, currency } } });
    if (!wallet) throw new DomainError('NOT_FOUND', `Recipient has no ${currency} wallet`);
    return wallet;
  }

  // ─────────────────────────── quotes ───────────────────────────

  async createQuote(userId: string, dto: CreateTransferQuoteDto): Promise<TransferQuoteDto> {
    const source = await this.wallets.getOwned(userId, dto.fromWalletId);
    const recipient = await this.resolveRecipient(userId, dto.to);
    const target = await this.recipientWallet(recipient.id, dto.toCurrency);
    const from = source.currency;
    const to = dto.toCurrency;

    let send: bigint;
    let receive: bigint;
    let midRate: bigint | null = null;
    let customerRate: bigint | null = null;
    let product: FeeProduct = 'P2P';
    if (from === to) {
      send = receive = toMinor(dto.amount, from);
    } else {
      product = 'P2P_FX';
      midRate = await this.rates.midRate(from, to);
      customerRate = applySpread(midRate, this.config.get('FX_SPREAD_BPS'));
      if (dto.amountSide === 'SEND') {
        send = toMinor(dto.amount, from);
        receive = convertMinor(send, customerRate, from, to);
      } else {
        receive = toMinor(dto.amount, to);
        send = sendForReceive(receive, customerRate, from, to);
      }
      if (receive <= 0n || send <= 0n) throw new DomainError('INVALID_AMOUNT', 'Amount too small to convert');
    }
    const fee = await this.fees.fee(product, from, send);

    const quote = await this.prisma.transferQuote.create({
      data: {
        userId,
        fromWalletId: source.id,
        toUserId: recipient.id,
        toWalletId: target.id,
        fromCurrency: from,
        toCurrency: to,
        amountSide: dto.amountSide,
        sendAmount: send,
        receiveAmount: receive,
        fee,
        feeProduct: product,
        midRate,
        customerRate,
        expiresAt: addSeconds(new Date(), this.config.get('TRANSFER_QUOTE_TTL_SECONDS')),
      },
    });
    this.logger.info({ quoteId: quote.id, from, to, product }, 'Transfer quote created');
    return transferQuoteView(quote, recipient);
  }

  // ─────────────────────────── execution ───────────────────────────

  async transfer(userId: string, dto: CreateTransferDto, idempotencyKey: string): Promise<Payment> {
    if (dto.quoteId) {
      if (dto.fromWalletId || dto.amount || dto.toPhone || dto.toUsername) {
        throw new DomainError('VALIDATION_FAILED', 'Send either quoteId or fromWalletId/amount/recipient, not both');
      }
      return this.executeQuote(userId, dto.quoteId, dto.pin, dto.note, idempotencyKey);
    }
    return this.transferDirect(userId, dto, idempotencyKey);
  }

  /** Same-currency transfer without a quote (the phase-1 body, now also by username). */
  private async transferDirect(userId: string, dto: CreateTransferDto, idempotencyKey: string): Promise<Payment> {
    const source = await this.wallets.getOwned(userId, dto.fromWalletId as string);
    const amount = toMinor(dto.amount as string, source.currency);
    const recipient = await this.resolveRecipient(userId, { phone: dto.toPhone, username: dto.toUsername });
    const target = await this.recipientWallet(recipient.id, source.currency);
    await this.pins.verify(userId, dto.pin);

    const fee = await this.fees.fee('P2P', source.currency, amount);
    const requestHash = operationHash('transfer.direct', {
      fromWalletId: source.id,
      toUserId: recipient.id,
      amount: amount.toString(),
      note: dto.note ?? null,
    });
    return this.engine.execute(
      {
        type: 'P2P',
        externalRef: externalRefFor(userId, idempotencyKey),
        requestHash,
        payerUserId: userId,
        payerWalletId: source.id,
        payeeUserId: recipient.id,
        payeeWalletId: target.id,
        currency: source.currency,
        amount,
        fee,
        reference: dto.note ?? null,
      },
      (payment) => this.p2pPlan(payment, source, target, null),
    );
  }

  private async executeQuote(userId: string, quoteId: string, pin: string, note: string | undefined, idempotencyKey: string) {
    const quote = await this.prisma.transferQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.userId !== userId) throw new DomainError('NOT_FOUND', 'Quote not found');
    const externalRef = externalRefFor(userId, idempotencyKey);
    const requestHash = operationHash('transfer.quote', { quoteId, note: note ?? null });

    // A retry of an already-executed quote with the same key replays the payment.
    const prior = await this.engine.findByExternalRef(externalRef);
    const replay = prior ? this.engine.replayOrNull(prior, requestHash) : null;
    if (replay) return replay;
    if (!prior) {
      if (quote.status === 'EXECUTED') throw new DomainError('QUOTE_ALREADY_EXECUTED', 'Quote has already been executed');
      if (quote.status === 'EXPIRED' || quote.expiresAt <= new Date()) {
        await this.prisma.transferQuote.updateMany({ where: { id: quote.id, status: 'OPEN' }, data: { status: 'EXPIRED' } });
        throw new DomainError('QUOTE_EXPIRED', 'Quote has expired; request a new one');
      }
    }

    await this.pins.verify(userId, pin);
    const source = await this.wallets.getOwned(userId, quote.fromWalletId);
    const target = await this.prisma.wallet.findUniqueOrThrow({ where: { id: quote.toWalletId } });
    const fx = quote.fromCurrency !== quote.toCurrency;

    return this.engine.execute(
      {
        type: fx ? 'P2P_FX' : 'P2P',
        externalRef,
        requestHash,
        payerUserId: userId,
        payerWalletId: source.id,
        payeeUserId: quote.toUserId,
        payeeWalletId: target.id,
        transferQuoteId: quote.id,
        currency: quote.fromCurrency,
        amount: quote.sendAmount,
        fee: quote.fee,
        receivedCurrency: fx ? quote.toCurrency : null,
        receivedAmount: fx ? quote.receiveAmount : null,
        reference: note ?? null,
      },
      (payment) => this.p2pPlan(payment, source, target, quote),
    );
  }

  /** Money plan for P2P / P2P_FX, built from the persisted payment. */
  private async p2pPlan(payment: Payment, source: Wallet, target: Wallet, quote: TransferQuote | null): Promise<MoneyPlan> {
    const fx = payment.receivedCurrency !== null && payment.receivedCurrency !== payment.currency;
    const toCurrency = payment.receivedCurrency ?? payment.currency;
    const receive = payment.receivedAmount ?? payment.amount;
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', payment.currency);
    const { legs, lock } = p2pLegs({
      sourceAccount: source.ledgerAccountId,
      targetAccount: target.ledgerAccountId,
      send: payment.amount,
      fee: payment.fee,
      receive,
      feeRevenue,
      fx: fx
        ? {
            settleFrom: await this.ledger.systemAccountId('SETTLEMENT', payment.currency),
            settleTo: await this.ledger.systemAccountId('SETTLEMENT', toCurrency),
          }
        : null,
    });

    return {
      lockAccountIds: lock,
      activeWalletIds: [source.id, target.id],
      entryType: 'PAYMENT',
      description: payment.reference ? `Transfer: ${payment.reference}` : fx ? `Transfer ${payment.currency}->${toCurrency}` : 'Wallet transfer',
      legs,
      metadata: {
        fromWalletId: source.id,
        toWalletId: target.id,
        currency: payment.currency,
        ...(quote?.customerRate ? { customerRate: formatRate(quote.customerRate), toCurrency } : {}),
      },
      validate: async (tx, locked) => {
        if (quote) await this.claimQuote(tx, quote.id, payment.id);
        await this.checkP2PLimits(tx, locked, {
          senderId: payment.payerUserId as string,
          recipientId: payment.payeeUserId as string,
          sourceAccount: source.ledgerAccountId,
          targetAccount: target.ledgerAccountId,
          fromCurrency: payment.currency,
          toCurrency,
          debit: payment.amount + payment.fee,
          credit: receive,
        });
      },
    };
  }

  private async claimQuote(tx: Tx, quoteId: string, paymentId: string): Promise<void> {
    const claimed = await tx.transferQuote.updateMany({
      where: { id: quoteId, status: 'OPEN', expiresAt: { gt: new Date() } },
      data: { status: 'EXECUTED', paymentId },
    });
    if (claimed.count === 1) return;
    const q = await tx.transferQuote.findUniqueOrThrow({ where: { id: quoteId } });
    if (q.status === 'EXECUTED') throw new DomainError('QUOTE_ALREADY_EXECUTED', 'Quote has already been executed');
    throw new DomainError('QUOTE_EXPIRED', 'Quote has expired; request a new one');
  }

  /** Sender outflow (per-txn/daily/monthly) and recipient inflow (max balance), on locked balances. */
  async checkP2PLimits(
    tx: Tx,
    locked: Map<string, LockedAccount>,
    p: {
      senderId: string;
      recipientId: string;
      sourceAccount: string;
      targetAccount: string;
      fromCurrency: Currency;
      toCurrency: Currency;
      debit: bigint;
      credit: bigint;
    },
  ): Promise<void> {
    const users = await tx.user.findMany({ where: { id: { in: [p.senderId, p.recipientId] } }, select: { id: true, kycTier: true } });
    const tierOf = (id: string) => users.find((u) => u.id === id)?.kycTier ?? 'TIER_0';
    await this.limits.assertOutflow(tx, { tier: tierOf(p.senderId), currency: p.fromCurrency, accountId: p.sourceAccount, amount: p.debit });
    await this.limits
      .assertInflow(tx, {
        tier: tierOf(p.recipientId),
        currency: p.toCurrency,
        currentBalance: locked.get(p.targetAccount)?.balance ?? 0n,
        amount: p.credit,
        enforcePerTxn: false,
      })
      .catch((err: unknown) => {
        if (err instanceof DomainError) {
          throw new DomainError(err.code, 'Recipient cannot receive this amount', { ...(err.details ?? {}), reason: 'RECIPIENT_LIMIT' });
        }
        throw err;
      });
  }

  /** Expire OPEN transfer quotes past their TTL (housekeeping job). */
  async expireQuotes(now = new Date()): Promise<number> {
    const { count } = await this.prisma.transferQuote.updateMany({
      where: { status: 'OPEN', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}
