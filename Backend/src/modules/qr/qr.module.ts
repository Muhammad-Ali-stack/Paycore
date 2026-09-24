import { Body, Controller, HttpCode, Module, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { Idempotent, idempotencyKeyOf } from '../../common/idempotency/idempotency.interceptor';
import { AuthModule } from '../auth/auth.module';
import { FeesModule } from '../fees/fees.service';
import { KycModule } from '../kyc/kyc.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentDto } from '../payments/payment.dto';
import { PaymentViews, PaymentsModule } from '../payments/payments.module';
import { TransfersModule } from '../transfers/transfers.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CreateReceiveQrDto, PayQrDto, QrPreviewDto, ReceiveQrDto, ResolveQrDto } from './qr.dto';
import { QrService } from './qr.service';

@ApiTags('qr')
@ApiBearerAuth()
@Controller('qr')
export class QrController {
  constructor(
    private readonly qr: QrService,
    private readonly views: PaymentViews,
  ) {}

  /** Consumer "My QR" to receive money (with an amount: single use, expires). */
  @Post('receive')
  @ApiCreatedResponse({ type: ReceiveQrDto })
  receive(@CurrentUser() user: AuthUser, @Body() dto: CreateReceiveQrDto): Promise<ReceiveQrDto> {
    return this.qr.createReceive(user.id, dto);
  }

  /** Verify a scanned payload and preview the payment (payee, amount, fee) with a short-lived token. */
  @Post('resolve')
  @HttpCode(200)
  @ApiOkResponse({ type: QrPreviewDto })
  resolve(@CurrentUser() user: AuthUser, @Body() dto: ResolveQrDto): Promise<QrPreviewDto> {
    return this.qr.resolve(user.id, dto.payload);
  }

  /** Pay a resolved QR. Dynamic codes are single use (409 QR_ALREADY_PAID). */
  @Post('pay')
  @Idempotent()
  @ApiCreatedResponse({ type: PaymentDto })
  async pay(@CurrentUser() user: AuthUser, @Body() dto: PayQrDto, @Req() req: Request): Promise<PaymentDto> {
    return this.views.one(await this.qr.pay(user.id, dto, idempotencyKeyOf(req)));
  }
}

@Module({
  imports: [LedgerModule, WalletsModule, KycModule, AuthModule, FeesModule, PaymentsModule, TransfersModule],
  controllers: [QrController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
