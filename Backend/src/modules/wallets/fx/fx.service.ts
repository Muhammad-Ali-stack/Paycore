import { Injectable } from '@nestjs/common';
import { Currency, FxQuote } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../../config/app-config';
import { DomainError } from '../../../common/errors/domain-error';
import { formatAmount, moneyView } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { addSeconds } from '../../../common/util/time';
import { PinService } from '../../auth/pin.service';
import { LimitsService } from '../../kyc/limits.service';
import { LedgerService } from '../../ledger/ledger.service';
import { credit, debit, LegInput } from '../../ledger/ledger.validation';
import { externalRefFor, PaymentsService } from '../payments.service';
import { toMinor, WalletsService } from '../wallets.service';
import { formatRate, priceQuote } from './fx.math';
import { RatesService } from './rates.service';

export function quoteView(q: FxQuote) {
  return {
    id: q.id,
    fromCurrency: q.fromCurrency,
    toCurrency: q.toCurrency,
    sell: moneyView(q.sellAmount, q.fromCurrency),
    fee: moneyView(q.feeAmount, q.fromCurrency),
    totalDebit: moneyView(q.sellAmount + q.feeAmount, q.fromCurrency),
    buy: moneyView(q.buyAmount, q.toCurrency),
    midRate: formatRate(q.midRate),
    customerRate: formatRate(q.customerRate),
    spreadBps: q.spreadBps,
    feeBps: q.feeBps,
    status: q.status === 'OPEN' && q.expiresAt <= new Date() ? 'EXPIRED' : q.status,
    expiresAt: q.expiresAt.toISOString(),
    journalEntryId: q.journalEntryId,
  };
}

/**
 * FX conversion between a user's own wallets, priced by a short-lived, single-use quote.
 * One journal entry, balanced per currency via the SETTLEMENT (FX position) accounts:
 *   from-ccy:  DR user wallet (sell+fee) | CR settlement (sell) | CR fee revenue (fee)
 *   to-ccy:    DR settlement (buy)       | CR user wallet (buy)
 */
@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly payments: PaymentsService,
    private readonly limits: LimitsService,
    private readonly pins: PinService,
    private readonly config: AppConfig,
    @InjectPinoLogger(FxService.name) private readonly logger: PinoLogger,
  ) {}

  async createQuote(userId: string, input: { fromCurrency: Currency; toCurrency: Currency; sellAmount: string }) {
    if (input.fromCurrency === input.toCurrency) {
      throw new DomainError('VALIDATION_FAILED', 'fromCurrency and toCurrency must differ');
    }
    await this.requireWallet(userId, input.fromCurrency);
    await this.requireWallet(userId, input.toCurrency);

    const sellAmount = toMinor(input.sellAmount, input.fromCurrency);
    const spreadBps = this.config.get('FX_SPREAD_BPS');
    const feeBps = this.config.get('FX_FEE_BPS');
    const priced = priceQuote({
      from: input.fromCurrency,
      to: input.toCurrency,
      sellAmount,
      midRate: await this.rates.midRate(input.fromCurrency, input.toCurrency),
      spreadBps,
      feeBps,
    });
    if (priced.buyAmount <= 0n) throw new DomainError('INVALID_AMOUNT', 'Amount too small to convert');

    const quote = await this.prisma.fxQuote.create({
      data: {
        userId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        sellAmount: priced.sellAmount,
        buyAmount: priced.buyAmount,
        feeAmount: priced.feeAmount,
        midRate: priced.midRate,
        customerRate: priced.customerRate,
        spreadBps,
        feeBps,
        expiresAt: addSeconds(new Date(), this.config.get('FX_QUOTE_TTL_SECONDS')),
      },
    });
    return quoteView(quote);
  }

  async execute(userId: string, quoteId: string, pin: string, idempotencyKey: string) {
    const quote = await this.prisma.fxQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.userId !== userId) throw new DomainError('NOT_FOUND', 'Quote not found');
    const externalRef = externalRefFor(userId, idempotencyKey);

    // A retry of an already-executed conversion (same key) replays the original entry.
    if (quote.status === 'EXECUTED') {
      const prior = await this.ledger.findByExternalRef(externalRef);
      if (prior && prior.entry.id === quote.journalEntryId) return this.result(prior, quote, userId);
      throw new DomainError('QUOTE_ALREADY_EXECUTED', 'Quote has already been executed');
    }
    if (quote.status === 'EXPIRED' || quote.expiresAt <= new Date()) {
      await this.prisma.fxQuote.updateMany({ where: { id: quote.id, status: 'OPEN' }, data: { status: 'EXPIRED' } });
      throw new DomainError('QUOTE_EXPIRED', 'Quote has expired; request a new one');
    }

    await this.pins.verify(userId, pin);

    const src = await this.requireWallet(userId, quote.fromCurrency);
    const dst = await this.requireWallet(userId, quote.toCurrency);
    const settleFrom = await this.ledger.systemAccountId('SETTLEMENT', quote.fromCurrency);
    const settleTo = await this.ledger.systemAccountId('SETTLEMENT', quote.toCurrency);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', quote.fromCurrency);

    const posted = await this.payments.postOnce(externalRef, 'FX_CONVERSION', async (tx) => {
      // Row locks first (ascending id order), so the snapshot and the locks line up.
      const locked = await this.ledger.lockAccounts(tx, [
        src.ledgerAccountId,
        dst.ledgerAccountId,
        settleFrom,
        settleTo,
        ...(quote.feeAmount > 0n ? [feeRevenue] : []),
      ]);
      // Claim the quote (single use). Rolled back with everything else if posting fails.
      const claimed = await tx.fxQuote.updateMany({
        where: { id: quote.id, userId, status: 'OPEN', expiresAt: { gt: new Date() } },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new DomainError('QUOTE_ALREADY_EXECUTED', 'Quote has already been executed or has expired');
      }

      await this.wallets.assertActive(tx, [src.id, dst.id]);
      const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
      await this.limits.assertOutflow(tx, {
        tier: kycTier,
        currency: quote.fromCurrency,
        accountId: src.ledgerAccountId,
        amount: quote.sellAmount + quote.feeAmount,
      });
      await this.limits.assertInflow(tx, {
        tier: kycTier,
        currency: quote.toCurrency,
        currentBalance: locked.get(dst.ledgerAccountId)?.balance ?? 0n,
        amount: quote.buyAmount,
        enforcePerTxn: false,
      });

      const legs: LegInput[] = [
        debit(src.ledgerAccountId, quote.sellAmount + quote.feeAmount),
        credit(settleFrom, quote.sellAmount),
        debit(settleTo, quote.buyAmount),
        credit(dst.ledgerAccountId, quote.buyAmount),
      ];
      if (quote.feeAmount > 0n) legs.push(credit(feeRevenue, quote.feeAmount));

      const result = await this.ledger.post(tx, {
        type: 'FX_CONVERSION',
        description: `FX ${quote.fromCurrency}->${quote.toCurrency}`,
        externalRef,
        initiatedBy: userId,
        metadata: {
          quoteId: quote.id,
          sell: formatAmount(quote.sellAmount, quote.fromCurrency),
          buy: formatAmount(quote.buyAmount, quote.toCurrency),
          fee: formatAmount(quote.feeAmount, quote.fromCurrency),
          customerRate: formatRate(quote.customerRate),
          fromCurrency: quote.fromCurrency,
          toCurrency: quote.toCurrency,
        },
        legs,
      });
      await tx.fxQuote.update({ where: { id: quote.id }, data: { journalEntryId: result.entry.id } });
      return result;
    });

    this.logger.info({ quoteId, entryId: posted.entry.id }, 'FX conversion executed');
    const fresh = await this.prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } });
    return this.result(posted, fresh, userId);
  }

  private async result(posted: Parameters<WalletsService['viewForUser']>[0], quote: FxQuote, userId: string) {
    return { quote: quoteView(quote), transaction: await this.wallets.viewForUser(posted, userId) };
  }

  private async requireWallet(userId: string, currency: Currency) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId_currency: { userId, currency } } });
    if (!wallet) throw new DomainError('NOT_FOUND', `Open a ${currency} wallet first`);
    return wallet;
  }
}
