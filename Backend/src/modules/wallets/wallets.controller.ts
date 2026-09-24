import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Idempotent, idempotencyKeyOf } from '../../common/idempotency/idempotency.interceptor';
import {
  AdminWalletDto,
  ConversionResultDto,
  CreateQuoteDto,
  CreateWalletDto,
  DepositDto,
  ExecuteConversionDto,
  FxQuoteDto,
  FxRatesTableDto,
  HistoryQuery,
  SetWalletStatusDto,
  TransactionDto,
  WalletDto,
  WalletHistoryPageDto,
  WithdrawDto,
} from './dto/wallets.dto';
import { FxService } from './fx/fx.service';
import { RatesService } from './fx/rates.service';
import { PaymentsService } from './payments.service';
import { walletView } from './wallet.mapper';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly payments: PaymentsService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: WalletDto })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWalletDto): Promise<WalletDto> {
    return walletView(await this.wallets.create(user.id, dto.currency));
  }

  @Get()
  @ApiOkResponse({ type: [WalletDto] })
  async list(@CurrentUser() user: AuthUser): Promise<WalletDto[]> {
    return (await this.wallets.list(user.id)).map(walletView);
  }

  @Get(':id')
  @ApiOkResponse({ type: WalletDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<WalletDto> {
    return walletView(await this.wallets.getOwned(user.id, id));
  }

  @Get(':id/transactions')
  @ApiOkResponse({ type: WalletHistoryPageDto })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: HistoryQuery): Promise<WalletHistoryPageDto> {
    return this.wallets.history(user.id, id, query);
  }

  /** Simulated synchronous top-up (phase-1 sandbox rail; use POST /funding/topups for the async bank flow). */
  @Post(':id/deposits')
  @Idempotent()
  @ApiCreatedResponse({ type: TransactionDto })
  deposit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepositDto,
    @Req() req: Request,
  ): Promise<TransactionDto> {
    return this.payments.deposit(user.id, id, dto.amount, idempotencyKeyOf(req));
  }

  /** Synchronous sandbox withdrawal (phase 1; use POST /funding/withdrawals for the async bank flow). */
  @Post(':id/withdrawals')
  @Idempotent()
  @ApiCreatedResponse({ type: TransactionDto })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawDto,
    @Req() req: Request,
  ): Promise<TransactionDto> {
    return this.payments.withdraw(user.id, id, dto.amount, dto.pin, idempotencyKeyOf(req));
  }
}

@ApiTags('fx')
@ApiBearerAuth()
@Controller('fx')
export class FxController {
  constructor(
    private readonly fx: FxService,
    private readonly rates: RatesService,
  ) {}

  @Get('rates')
  @ApiOkResponse({ type: FxRatesTableDto })
  rates_(): Promise<FxRatesTableDto> {
    return this.rates.table();
  }

  @Post('quotes')
  @ApiCreatedResponse({ type: FxQuoteDto })
  quote(@CurrentUser() user: AuthUser, @Body() dto: CreateQuoteDto): Promise<FxQuoteDto> {
    return this.fx.createQuote(user.id, dto);
  }

  @Post('conversions')
  @Idempotent()
  @ApiCreatedResponse({ type: ConversionResultDto })
  convert(@CurrentUser() user: AuthUser, @Body() dto: ExecuteConversionDto, @Req() req: Request): Promise<ConversionResultDto> {
    return this.fx.execute(user.id, dto.quoteId, dto.pin, idempotencyKeyOf(req));
  }
}

@ApiTags('admin / wallets')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/wallets')
export class AdminWalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get(':id')
  @ApiOkResponse({ type: AdminWalletDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminWalletDto> {
    const wallet = await this.wallets.getById(id);
    return { ...walletView(wallet), userId: wallet.userId, ledgerAccountId: wallet.ledgerAccountId };
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOkResponse({ type: WalletDto })
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWalletStatusDto, @CurrentUser() admin: AuthUser): Promise<WalletDto> {
    return walletView(await this.wallets.setStatus(id, dto.status, admin.id, dto.reason));
  }
}
