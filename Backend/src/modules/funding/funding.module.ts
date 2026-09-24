import {
  Body,
  CanActivate,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { Idempotent, idempotencyKeyOf } from '../../common/idempotency/idempotency.interceptor';
import { AppConfig } from '../../config/app-config';
import { AuthModule } from '../auth/auth.module';
import { FeesModule } from '../fees/fees.service';
import { KycModule } from '../kyc/kyc.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BANK_ADAPTER } from './bank.adapter';
import { BankSimulatorService } from './bank-simulator.service';
import { BankWebhookService } from './bank-webhook.service';
import {
  CreateTopupDto,
  CreateWithdrawalDto,
  FundingPageDto,
  FundingTransactionDto,
  ListFundingQuery,
  ReconciliationRunDto,
  ReconciliationRunPageDto,
  RunReconciliationDto,
  SimulateBankDto,
  SimulationResultDto,
  WebhookReceiptDto,
} from './funding.dto';
import { FundingService, fundingView } from './funding.service';
import { ReconciliationService } from './reconciliation.service';
import { SimulatedBankAdapter } from './simulated-bank.adapter';
import { SIGNATURE_HEADER } from './webhook.signature';
import { ListQuery } from '../merchants/merchants.dto';

@ApiTags('funding')
@ApiBearerAuth()
@Controller('funding')
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  /** Start a top-up. Returns PENDING (with bank-transfer instructions); the wallet is credited on SUCCEEDED. */
  @Post('topups')
  @Idempotent()
  @ApiCreatedResponse({ type: FundingTransactionDto })
  async topup(@CurrentUser() user: AuthUser, @Body() dto: CreateTopupDto, @Req() req: Request): Promise<FundingTransactionDto> {
    return fundingView(await this.funding.topup(user.id, dto, idempotencyKeyOf(req)));
  }

  /** Withdraw to a bank account. Funds (amount + fee) are held immediately and released or paid out on the outcome. */
  @Post('withdrawals')
  @Idempotent()
  @ApiCreatedResponse({ type: FundingTransactionDto })
  async withdraw(@CurrentUser() user: AuthUser, @Body() dto: CreateWithdrawalDto, @Req() req: Request): Promise<FundingTransactionDto> {
    return fundingView(await this.funding.withdraw(user.id, dto, idempotencyKeyOf(req)));
  }

  @Get('transactions')
  @ApiOkResponse({ type: FundingPageDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListFundingQuery): Promise<FundingPageDto> {
    return this.funding.list(user.id, query);
  }

  @Get('transactions/:id')
  @ApiOkResponse({ type: FundingTransactionDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<FundingTransactionDto> {
    return fundingView(await this.funding.get(user.id, id));
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class BankWebhooksController {
  constructor(private readonly webhooks: BankWebhookService) {}

  /**
   * Bank -> PayCore outcome notifications. Authenticated by HMAC-SHA256 over `<t>.<raw body>`
   * (`X-PayCore-Signature: t=<unix>,v1=<hex>`), rejected outside the timestamp tolerance, and
   * deduplicated by the bank's event id.
   */
  @Public()
  @Post('bank')
  @HttpCode(200)
  @ApiHeader({ name: 'X-PayCore-Signature', required: true, description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">' })
  @ApiOkResponse({ type: WebhookReceiptDto })
  receive(@Req() req: RawBodyRequest<Request>, @Headers(SIGNATURE_HEADER) signature: string | undefined): Promise<WebhookReceiptDto> {
    return this.webhooks.receive(req.rawBody, signature);
  }
}

/** Second line of defence for /dev routes (the first is env validation refusing BANK_SIM_ENABLED in production). */
@Injectable()
export class DevToolsGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (this.config.isProduction || !this.config.get('BANK_SIM_ENABLED')) {
      throw new DomainError('FEATURE_DISABLED', 'Not found');
    }
    return true;
  }
}

@ApiTags('dev')
@ApiBearerAuth()
@UseGuards(DevToolsGuard)
@Controller('dev/bank')
export class DevBankController {
  constructor(private readonly simulator: BankSimulatorService) {}

  /** Non-production only: make the simulated bank report an outcome (sends a signed webhook). */
  @Post('simulate')
  @HttpCode(200)
  @ApiOkResponse({ type: SimulationResultDto })
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateBankDto): Promise<SimulationResultDto> {
    return this.simulator.simulate(user, dto);
  }
}

@ApiTags('admin / reconciliation')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/reconciliation')
export class AdminReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('runs')
  @ApiOkResponse({ type: ReconciliationRunPageDto })
  list(@Query() query: ListQuery): Promise<ReconciliationRunPageDto> {
    return this.reconciliation.list(query.cursor, query.limit ?? 25);
  }

  /** Reconcile the bank statement for `date` (default: yesterday UTC) against the ledger. */
  @Post('runs')
  @ApiCreatedResponse({ type: ReconciliationRunDto })
  run(@Body() dto: RunReconciliationDto, @CurrentUser() admin: AuthUser): Promise<ReconciliationRunDto> {
    return this.reconciliation.run(dto.date, admin.id);
  }

  @Get('runs/:id')
  @ApiOkResponse({ type: ReconciliationRunDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ReconciliationRunDto> {
    return this.reconciliation.get(id);
  }
}

// The simulator route is not even registered in production builds (belt and braces with the guard).
const devControllers = process.env.NODE_ENV === 'production' ? [] : [DevBankController];

@Module({
  imports: [LedgerModule, WalletsModule, KycModule, AuthModule, FeesModule],
  controllers: [FundingController, BankWebhooksController, AdminReconciliationController, ...devControllers],
  providers: [
    FundingService,
    BankWebhookService,
    ReconciliationService,
    BankSimulatorService,
    SimulatedBankAdapter,
    DevToolsGuard,
    { provide: BANK_ADAPTER, useExisting: SimulatedBankAdapter },
  ],
  exports: [FundingService, BankWebhookService, ReconciliationService, BankSimulatorService, BANK_ADAPTER],
})
export class FundingModule {}
