import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
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
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentRequestsService } from './payment-requests.service';
import {
  AcceptPaymentRequestDto,
  CreatePaymentRequestDto,
  CreateTransferDto,
  CreateTransferQuoteDto,
  ListPaymentRequestsQuery,
  PaymentRequestDto,
  PaymentRequestPageDto,
  TransferQuoteDto,
} from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly views: PaymentViews,
  ) {}

  /** Price a transfer (same- or cross-currency). Quotes are single use and short-lived. */
  @Post('quotes')
  @ApiCreatedResponse({ type: TransferQuoteDto })
  quote(@CurrentUser() user: AuthUser, @Body() dto: CreateTransferQuoteDto): Promise<TransferQuoteDto> {
    return this.transfers.createQuote(user.id, dto);
  }

  /** Send money: `{quoteId, pin, note?}` or `{fromWalletId, toPhone | toUsername, amount, pin, note?}`. */
  @Post()
  @Idempotent()
  @ApiCreatedResponse({ type: PaymentDto })
  async transfer(@CurrentUser() user: AuthUser, @Body() dto: CreateTransferDto, @Req() req: Request): Promise<PaymentDto> {
    return this.views.one(await this.transfers.transfer(user.id, dto, idempotencyKeyOf(req)));
  }
}

@ApiTags('payment requests')
@ApiBearerAuth()
@Controller('payment-requests')
export class PaymentRequestsController {
  constructor(
    private readonly requests: PaymentRequestsService,
    private readonly views: PaymentViews,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: PaymentRequestDto })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentRequestDto): Promise<PaymentRequestDto> {
    return this.requests.view(await this.requests.create(user.id, dto));
  }

  @Get()
  @ApiOkResponse({ type: PaymentRequestPageDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListPaymentRequestsQuery): Promise<PaymentRequestPageDto> {
    return this.requests.list(user.id, query);
  }

  /** Pay a request addressed to you. */
  @Post(':id/accept')
  @Idempotent()
  @ApiCreatedResponse({ type: PaymentDto })
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptPaymentRequestDto,
    @Req() req: Request,
  ): Promise<PaymentDto> {
    return this.views.one(await this.requests.accept(user.id, id, dto, idempotencyKeyOf(req)));
  }

  @Post(':id/decline')
  @HttpCode(200)
  @ApiOkResponse({ type: PaymentRequestDto })
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentRequestDto> {
    return this.requests.view(await this.requests.decline(user.id, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: PaymentRequestDto })
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentRequestDto> {
    return this.requests.view(await this.requests.cancel(user.id, id));
  }
}

@Module({
  imports: [LedgerModule, WalletsModule, KycModule, AuthModule, UsersModule, FeesModule, PaymentsModule],
  controllers: [TransfersController, PaymentRequestsController],
  providers: [TransfersService, PaymentRequestsService],
  exports: [TransfersService, PaymentRequestsService],
})
export class TransfersModule {}
