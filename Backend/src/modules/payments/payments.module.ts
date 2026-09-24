import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Payment } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentEngine } from './payment-engine.service';
import { PaymentDto } from './payment.dto';
import { merchantPaymentView, paymentView } from './payment.mapper';
import { PartiesService } from './parties';

/** Read-side helpers shared by every module that returns payments. */
@Injectable()
export class PaymentViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parties: PartiesService,
  ) {}

  async one(payment: Payment): Promise<PaymentDto> {
    const parties = await this.parties.forPayments([payment]);
    return paymentView(payment, parties.get(payment.id)!);
  }

  async many(payments: Payment[]): Promise<PaymentDto[]> {
    const parties = await this.parties.forPayments(payments);
    return payments.map((p) => paymentView(p, parties.get(p.id)!));
  }

  async merchantMany(payments: Payment[]) {
    const parties = await this.parties.forPayments(payments);
    return payments.map((p) => merchantPaymentView(p, parties.get(p.id)!));
  }

  /** Payer, payee or the owner of the merchant involved; anyone else gets 404. */
  async getVisible(userId: string, paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (payment.payerUserId === userId || payment.payeeUserId === userId) return payment;
    if (payment.merchantId) {
      const merchant = await this.prisma.merchant.findUnique({ where: { id: payment.merchantId }, select: { ownerUserId: true } });
      if (merchant?.ownerUserId === userId) return payment;
    }
    throw new DomainError('NOT_FOUND', 'Payment not found');
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly views: PaymentViews) {}

  /** A payment with its full status timeline. Visible to the payer, the payee and the merchant owner. */
  @Get(':id')
  @ApiOkResponse({ type: PaymentDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentDto> {
    return this.views.one(await this.views.getVisible(user.id, id));
  }
}

@Module({
  imports: [LedgerModule, WalletsModule],
  controllers: [PaymentsController],
  providers: [PaymentEngine, PartiesService, PaymentViews],
  exports: [PaymentEngine, PartiesService, PaymentViews],
})
export class PaymentsModule {}
