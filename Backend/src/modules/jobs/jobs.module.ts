import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DomainEventBus } from '../../common/outbox/event-bus';
import { OutboxRelay } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JOBS, JobRegistry } from '../../common/queue/job-registry';
import { FundingModule } from '../funding/funding.module';
import { FundingService } from '../funding/funding.service';
import { ReconciliationService } from '../funding/reconciliation.service';
import { PaymentEngine } from '../payments/payment-engine.service';
import { PaymentsModule } from '../payments/payments.module';
import { QrModule } from '../qr/qr.module';
import { QrService } from '../qr/qr.service';
import { SettlementModule } from '../settlement/settlement.module';
import { SettlementService } from '../settlement/settlement.service';
import { PaymentRequestsService } from '../transfers/payment-requests.service';
import { TransfersModule } from '../transfers/transfers.module';
import { TransfersService } from '../transfers/transfers.service';
import { BullmqWorkerHost } from './bullmq-worker.host';

/**
 * Wires every repeatable job to its handler and registers the notification consumer. The same
 * registry runs under the BullMQ worker process (QUEUE_DRIVER=bullmq) or the inline scheduler.
 * Tests call the services directly (drainOnce, runBatch(asOf), run(date), timeoutStale(now)...).
 */
@Injectable()
export class JobsRegistrar implements OnModuleInit {
  constructor(
    private readonly jobs: JobRegistry,
    private readonly bus: DomainEventBus,
    private readonly relay: OutboxRelay,
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly payments: PaymentEngine,
    private readonly transfers: TransfersService,
    private readonly requests: PaymentRequestsService,
    private readonly qr: QrService,
    private readonly funding: FundingService,
    private readonly settlement: SettlementService,
    private readonly reconciliation: ReconciliationService,
    @InjectPinoLogger(JobsRegistrar.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.jobs.register(JOBS.OUTBOX_RELAY, () => this.relay.drainAll());
    this.jobs.register(JOBS.PAYMENT_TIMEOUTS, async () => ({
      payments: await this.payments.timeoutStale(),
      funding: await this.funding.timeoutStale(),
      settlements: await this.settlement.timeoutStale(),
    }));
    this.jobs.register(JOBS.REQUEST_EXPIRY, async () => ({ expired: await this.requests.expireDue() }));
    this.jobs.register(JOBS.QUOTE_QR_EXPIRY, async () => {
      const now = new Date();
      const fx = await this.prisma.fxQuote.updateMany({ where: { status: 'OPEN', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      return {
        fxQuotes: fx.count,
        transferQuotes: await this.transfers.expireQuotes(now),
        qrCodes: await this.qr.expireCodes(now),
        idempotencyRecords: await this.idempotency.purgeExpired(),
      };
    });
    this.jobs.register(JOBS.SETTLEMENT_BATCH, async (data) => {
      const asOf = typeof data.asOf === 'string' ? new Date(data.asOf) : new Date();
      return { settlements: (await this.settlement.runBatch(asOf)).length };
    });
    this.jobs.register(JOBS.RECONCILIATION, async (data) => {
      const run = await this.reconciliation.run(typeof data.date === 'string' ? data.date : undefined, null);
      return { runId: run.id, mismatches: run.items.length };
    });

    // Simulated push notifications: a real deployment would call an SMS/push provider here.
    // Idempotent (logging) and keyed by the outbox event id.
    this.bus.subscribe('*', 'notifications.log', async (event) => {
      if (/^(payment|payment_request|funding|refund|settlement)\./.test(event.type)) {
        this.logger.info({ eventId: event.id, type: event.type, aggregateId: event.aggregateId }, 'Notification dispatched');
      }
    });
  }
}

@Module({
  imports: [PaymentsModule, TransfersModule, QrModule, FundingModule, SettlementModule],
  providers: [JobsRegistrar],
})
export class JobsModule {}

/**
 * Added ONLY by the worker entrypoint (src/worker.ts): BullMQ consumers and job schedulers.
 * Defined here (a file AppModule imports) so the host's @InjectPinoLogger context exists before
 * AppModule builds the logging module, whatever the entrypoint's import order.
 */
@Module({ providers: [BullmqWorkerHost] })
export class WorkerHostModule {}
