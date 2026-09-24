import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Idempotent, idempotencyKeyOf } from '../../common/idempotency/idempotency.interceptor';
import { LedgerModule } from '../ledger/ledger.module';
import { MerchantPaymentDto, MerchantPaymentPageDto } from '../payments/payment.dto';
import { PaymentViews, PaymentsModule } from '../payments/payments.module';
import { QrModule } from '../qr/qr.module';
import { DynamicQrDto } from '../qr/qr.dto';
import { dynamicQrView } from '../qr/qr.service';
import { WalletsModule } from '../wallets/wallets.module';
import {
  AdminMerchantsQuery,
  CreateDynamicQrDto,
  CreateMerchantDto,
  CreateOutletDto,
  CreateRefundDto,
  CreateTerminalDto,
  DashboardQuery,
  MerchantDashboardDto,
  MerchantDto,
  MerchantPageDto,
  MerchantPaymentsQuery,
  OutletDto,
  RefundDto,
  SetPricingDto,
  TerminalDto,
} from './merchants.dto';
import { MerchantsService, merchantView } from './merchants.service';
import { RefundsService, refundView } from './refunds.service';

@ApiTags('merchants')
@ApiBearerAuth()
@Roles('MERCHANT')
@Controller('merchants')
export class MerchantOnboardingController {
  constructor(private readonly merchants: MerchantsService) {}

  /** Onboard your business (MERCHANT role). Starts PENDING_REVIEW at KYB_0 until an admin approves. */
  @Post()
  @ApiCreatedResponse({ type: MerchantDto })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateMerchantDto): Promise<MerchantDto> {
    return merchantView(await this.merchants.onboard(user.id, dto));
  }
}

@ApiTags('merchant')
@ApiBearerAuth()
@Roles('MERCHANT')
@Controller('merchant')
export class MerchantController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly refunds: RefundsService,
    private readonly views: PaymentViews,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: MerchantDto })
  async me(@CurrentUser() user: AuthUser): Promise<MerchantDto> {
    return merchantView(await this.merchants.mine(user.id));
  }

  @Get('dashboard')
  @ApiOkResponse({ type: MerchantDashboardDto })
  dashboard(@CurrentUser() user: AuthUser, @Query() query: DashboardQuery): Promise<MerchantDashboardDto> {
    return this.merchants.dashboard(user.id, query.currency);
  }

  @Get('outlets')
  @ApiOkResponse({ type: [OutletDto] })
  outlets(@CurrentUser() user: AuthUser): Promise<OutletDto[]> {
    return this.merchants.outlets(user.id);
  }

  @Post('outlets')
  @ApiCreatedResponse({ type: OutletDto })
  createOutlet(@CurrentUser() user: AuthUser, @Body() dto: CreateOutletDto): Promise<OutletDto> {
    return this.merchants.createOutlet(user.id, dto);
  }

  @Get('outlets/:id/terminals')
  @ApiOkResponse({ type: [TerminalDto] })
  terminals(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TerminalDto[]> {
    return this.merchants.terminals(user.id, id);
  }

  @Post('outlets/:id/terminals')
  @ApiCreatedResponse({ type: TerminalDto })
  createTerminal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTerminalDto): Promise<TerminalDto> {
    return this.merchants.createTerminal(user.id, id, dto.label);
  }

  /** Single-use, amount-bound QR for one checkout. */
  @Post('qr/dynamic')
  @ApiCreatedResponse({ type: DynamicQrDto })
  async dynamicQr(@CurrentUser() user: AuthUser, @Body() dto: CreateDynamicQrDto): Promise<DynamicQrDto> {
    return dynamicQrView(await this.merchants.createDynamicQr(user.id, dto));
  }

  /** Status polling for the cashier screen (ACTIVE -> PAID | EXPIRED). */
  @Get('qr/:qrId')
  @ApiOkResponse({ type: DynamicQrDto })
  async qr(@CurrentUser() user: AuthUser, @Param('qrId', ParseUUIDPipe) qrId: string): Promise<DynamicQrDto> {
    return dynamicQrView(await this.merchants.getQr(user.id, qrId));
  }

  @Get('payments')
  @ApiOkResponse({ type: MerchantPaymentPageDto })
  async payments(@CurrentUser() user: AuthUser, @Query() query: MerchantPaymentsQuery): Promise<MerchantPaymentPageDto> {
    const page = await this.merchants.payments(user.id, query);
    return { items: await this.views.merchantMany(page.items), nextCursor: page.nextCursor };
  }

  @Get('payments/:id')
  @ApiOkResponse({ type: MerchantPaymentDto })
  async payment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MerchantPaymentDto> {
    const [view] = await this.views.merchantMany([await this.merchants.payment(user.id, id)]);
    return view as MerchantPaymentDto;
  }

  /** Full (default) or partial refund to the payer's wallet. Cumulative refunds can't exceed the payment. */
  @Post('payments/:id/refunds')
  @Idempotent()
  @ApiCreatedResponse({ type: RefundDto })
  async refund(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
    @Req() req: Request,
  ): Promise<RefundDto> {
    return refundView(await this.refunds.refund(user.id, id, dto, idempotencyKeyOf(req)));
  }
}

@ApiTags('admin / merchants')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/merchants')
export class AdminMerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @ApiOkResponse({ type: MerchantPageDto })
  list(@Query() query: AdminMerchantsQuery): Promise<MerchantPageDto> {
    return this.merchants.list(query);
  }

  @Put(':id/pricing')
  @ApiOkResponse({ type: MerchantDto })
  async pricing(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPricingDto, @CurrentUser() admin: AuthUser): Promise<MerchantDto> {
    return merchantView(await this.merchants.setPricing(id, dto.mdrBps, dto.settlementDelayDays, admin.id));
  }

  /** KYB approval: PENDING_REVIEW/SUSPENDED -> ACTIVE (KYB_0 -> KYB_1). */
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantDto })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser): Promise<MerchantDto> {
    return merchantView(await this.merchants.setStatus(id, 'ACTIVE', admin.id));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantDto })
  async suspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser): Promise<MerchantDto> {
    return merchantView(await this.merchants.setStatus(id, 'SUSPENDED', admin.id));
  }
}

@Module({
  imports: [LedgerModule, WalletsModule, PaymentsModule, QrModule],
  controllers: [MerchantOnboardingController, MerchantController, AdminMerchantsController],
  providers: [MerchantsService, RefundsService],
  exports: [MerchantsService, RefundsService],
})
export class MerchantsModule {}
