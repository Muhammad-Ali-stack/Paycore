import { Injectable } from '@nestjs/common';
import { Payment, PaymentRequest, PaymentRequestStatus, Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { moneyView } from '../../common/money/money';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { appendTimeline, timelineEntry } from '../../common/state/state-machine';
import { AppConfig } from '../../config/app-config';
import { PinService } from '../auth/pin.service';
import { FeesService } from '../fees/fees.service';
import { LedgerService } from '../ledger/ledger.service';
import { credit, debit, LegInput } from '../ledger/ledger.validation';
import { PaymentEngine, operationHash } from '../payments/payment-engine.service';
import { PartiesService, userParty } from '../payments/parties';
import { externalRefFor } from '../wallets/payments.service';
import { WalletsService, toMinor } from '../wallets/wallets.service';
import { effectiveRequestStatus, paymentRequestMachine } from './payment-request.state';
import { CreatePaymentRequestDto, ListPaymentRequestsQuery, PaymentRequestDto, PaymentRequestPageDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

/** "Request money": a user asks another user to pay; the payer accepts (pays), declines or ignores it. */
@Injectable()
export class PaymentRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly pins: PinService,
    private readonly fees: FeesService,
    private readonly engine: PaymentEngine,
    private readonly transfers: TransfersService,
    private readonly parties: PartiesService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfig,
    @InjectPinoLogger(PaymentRequestsService.name) private readonly logger: PinoLogger,
  ) {}

  async views(requests: PaymentRequest[]): Promise<PaymentRequestDto[]> {
    const users = await this.parties.users(requests.flatMap((r) => [r.requesterId, r.payerId]));
    const now = new Date();
    return requests.map((r) => ({
      id: r.id,
      requester: userParty(users.get(r.requesterId)),
      payer: userParty(users.get(r.payerId)),
      amount: moneyView(r.amount, r.currency),
      note: r.note,
      status: effectiveRequestStatus(r.status, r.expiresAt, now),
      expiresAt: r.expiresAt.toISOString(),
      paymentId: r.paymentId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async view(request: PaymentRequest): Promise<PaymentRequestDto> {
    return (await this.views([request]))[0] as PaymentRequestDto;
  }

  async create(userId: string, dto: CreatePaymentRequestDto): Promise<PaymentRequest> {
    const payer = await this.transfers.resolveRecipient(userId, dto.to);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId_currency: { userId, currency: dto.currency } } });
    if (!wallet || wallet.status !== 'ACTIVE') {
      throw new DomainError('NOT_FOUND', `Open an active ${dto.currency} wallet to receive this request`);
    }
    const amount = toMinor(dto.amount, dto.currency);
    const hours = dto.expiresInHours ?? this.config.get('PAYMENT_REQUEST_DEFAULT_TTL_HOURS');
    const now = new Date();
    return this.prisma.runInTransaction(async (tx) => {
      const request = await tx.paymentRequest.create({
        data: {
          requesterId: userId,
          payerId: payer.id,
          currency: dto.currency,
          amount,
          note: dto.note ?? null,
          expiresAt: new Date(now.getTime() + hours * 3600_000),
          timeline: [timelineEntry('PENDING', undefined, now)] as unknown as Prisma.InputJsonValue,
        },
      });
      await this.event(tx, request, 'payment_request.created');
      return request;
    });
  }

  async list(userId: string, q: ListPaymentRequestsQuery): Promise<PaymentRequestPageDto> {
    const take = q.limit ?? 25;
    const who: Prisma.PaymentRequestWhereInput =
      q.direction === 'INCOMING' ? { payerId: userId } : q.direction === 'OUTGOING' ? { requesterId: userId } : { OR: [{ payerId: userId }, { requesterId: userId }] };
    const now = new Date();
    // EXPIRED also matches PENDING rows past their expiry that the job hasn't swept yet.
    const status: Prisma.PaymentRequestWhereInput =
      q.status === 'EXPIRED'
        ? { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] }
        : q.status === 'PENDING'
          ? { status: 'PENDING', expiresAt: { gt: now } }
          : q.status
            ? { status: q.status }
            : {};
    const rows = await this.prisma.paymentRequest.findMany({
      where: { AND: [who, status] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    return { items: await this.views(page), nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null };
  }

  /** The payer pays the request. Exactly-once under concurrent accepts: the PENDING->ACCEPTED claim
   *  happens inside the payment transaction, so only one payment can complete. */
  async accept(userId: string, requestId: string, input: { fromWalletId: string; pin: string }, idempotencyKey: string): Promise<Payment> {
    const request = await this.prisma.paymentRequest.findUnique({ where: { id: requestId } });
    if (!request || request.payerId !== userId) throw new DomainError('NOT_FOUND', 'Payment request not found');

    const externalRef = externalRefFor(userId, idempotencyKey);
    const requestHash = operationHash('payment_request.accept', { requestId, fromWalletId: input.fromWalletId });
    const prior = await this.engine.findByExternalRef(externalRef);
    const replay = prior ? this.engine.replayOrNull(prior, requestHash) : null;
    if (replay) return replay;
    if (!prior) this.assertAcceptable(request);

    const source = await this.wallets.getOwned(userId, input.fromWalletId);
    if (source.currency !== request.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `This request must be paid from a ${request.currency} wallet`);
    }
    const target = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId: request.requesterId, currency: request.currency } },
    });
    if (!target) throw new DomainError('NOT_FOUND', `Requester has no ${request.currency} wallet`);
    await this.pins.verify(userId, input.pin);

    const fee = await this.fees.fee('REQUEST', request.currency, request.amount);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', request.currency);

    return this.engine.execute(
      {
        type: 'REQUEST',
        externalRef,
        requestHash,
        payerUserId: userId,
        payerWalletId: source.id,
        payeeUserId: request.requesterId,
        payeeWalletId: target.id,
        paymentRequestId: request.id,
        currency: request.currency,
        amount: request.amount,
        fee,
        reference: request.note,
      },
      (payment) => {
        const legs: LegInput[] = [debit(source.ledgerAccountId, payment.amount + payment.fee), credit(target.ledgerAccountId, payment.amount)];
        if (payment.fee > 0n) legs.push(credit(feeRevenue, payment.fee));
        return {
          lockAccountIds: payment.fee > 0n ? [source.ledgerAccountId, target.ledgerAccountId, feeRevenue] : [source.ledgerAccountId, target.ledgerAccountId],
          activeWalletIds: [source.id, target.id],
          entryType: 'PAYMENT',
          description: request.note ? `Payment request: ${request.note}` : 'Payment request',
          legs,
          metadata: { paymentRequestId: request.id, fromWalletId: source.id, toWalletId: target.id, currency: request.currency },
          validate: async (tx, locked) => {
            await this.claim(tx, request.id, payment.id);
            await this.transfers.checkP2PLimits(tx, locked, {
              senderId: userId,
              recipientId: request.requesterId,
              sourceAccount: source.ledgerAccountId,
              targetAccount: target.ledgerAccountId,
              fromCurrency: request.currency,
              toCurrency: request.currency,
              debit: payment.amount + payment.fee,
              credit: payment.amount,
            });
          },
        };
      },
    );
  }

  private assertAcceptable(r: PaymentRequest): void {
    if (r.status !== 'PENDING') {
      throw new DomainError('PAYMENT_REQUEST_NOT_PENDING', `Payment request is ${r.status.toLowerCase()}`, { status: r.status });
    }
    if (r.expiresAt <= new Date()) throw new DomainError('PAYMENT_REQUEST_EXPIRED', 'Payment request has expired');
  }

  /** PENDING -> ACCEPTED inside the payment transaction (compare-and-set). */
  private async claim(tx: Tx, requestId: string, paymentId: string): Promise<void> {
    const current = await tx.paymentRequest.findUniqueOrThrow({ where: { id: requestId } });
    this.assertAcceptable(current);
    paymentRequestMachine.assert(current.status, 'ACCEPTED');
    const res = await tx.paymentRequest.updateMany({
      where: { id: requestId, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'ACCEPTED', paymentId, timeline: appendTimeline(current.timeline, 'ACCEPTED') as unknown as Prisma.InputJsonValue },
    });
    if (res.count !== 1) throw new DomainError('PAYMENT_REQUEST_NOT_PENDING', 'Payment request is no longer pending');
    await this.event(tx, { ...current, status: 'ACCEPTED', paymentId }, 'payment_request.accepted');
  }

  async decline(userId: string, requestId: string): Promise<PaymentRequest> {
    return this.finish(requestId, (r) => r.payerId === userId, 'DECLINED');
  }

  async cancel(userId: string, requestId: string): Promise<PaymentRequest> {
    return this.finish(requestId, (r) => r.requesterId === userId, 'CANCELLED');
  }

  private async finish(requestId: string, allowed: (r: PaymentRequest) => boolean, to: PaymentRequestStatus, reason?: string): Promise<PaymentRequest> {
    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.paymentRequest.findUnique({ where: { id: requestId } });
      if (!current || !allowed(current)) throw new DomainError('NOT_FOUND', 'Payment request not found');
      if (to !== 'EXPIRED') this.assertAcceptable(current);
      paymentRequestMachine.assert(current.status, to);
      const res = await tx.paymentRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: to, timeline: appendTimeline(current.timeline, to, reason) as unknown as Prisma.InputJsonValue },
      });
      if (res.count !== 1) throw new DomainError('PAYMENT_REQUEST_NOT_PENDING', 'Payment request is no longer pending');
      const updated = await tx.paymentRequest.findUniqueOrThrow({ where: { id: requestId } });
      await this.event(tx, updated, `payment_request.${to.toLowerCase()}`);
      return updated;
    });
  }

  /** PENDING requests past their expiry -> EXPIRED (repeatable job). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.paymentRequest.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true },
      take: 500,
    });
    let expired = 0;
    for (const { id } of due) {
      try {
        await this.finish(id, () => true, 'EXPIRED', 'expired');
        expired++;
      } catch (err) {
        if (!(err instanceof DomainError)) this.logger.error({ err, requestId: id }, 'Expiring payment request failed');
      }
    }
    return expired;
  }

  private event(tx: Tx, r: PaymentRequest, eventType: string): Promise<void> {
    return this.outbox.enqueue(tx, {
      aggregateType: 'payment_request',
      aggregateId: r.id,
      eventType,
      payload: {
        requestId: r.id,
        requesterId: r.requesterId,
        payerId: r.payerId,
        status: r.status,
        currency: r.currency,
        amountMinor: r.amount.toString(),
        paymentId: r.paymentId,
      },
    });
  }
}
