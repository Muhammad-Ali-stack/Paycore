import { Body, Controller, Get, Header, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { FundingModule } from '../funding/funding.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ListQuery, SettlementDto, SettlementPageDto, SettlementRunDto } from '../merchants/merchants.dto';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantsService } from '../merchants/merchants.service';
import { settlementReportCsv, settlementView } from './settlement.mapper';
import { SettlementService } from './settlement.service';

export class RunSettlementDto {
  /** Run as if it were this instant (default now). Items completed before (asOf day - N days) are settled. */
  @IsOptional()
  @Type(() => String)
  @IsDateString()
  asOf?: string;
}

@ApiTags('merchant')
@ApiBearerAuth()
@Roles('MERCHANT')
@Controller('merchant/settlements')
export class MerchantSettlementsController {
  constructor(
    private readonly settlements: SettlementService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: SettlementPageDto })
  async list(@CurrentUser() user: AuthUser, @Query() query: ListQuery): Promise<SettlementPageDto> {
    const merchant = await this.merchants.mine(user.id);
    return this.settlements.list(merchant.id, query.cursor, query.limit ?? 25);
  }

  @Get(':id')
  @ApiOkResponse({ type: SettlementDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SettlementDto> {
    const merchant = await this.merchants.mine(user.id);
    const s = await this.settlements.getWithLines(merchant.id, id);
    return settlementView(s, s.lines);
  }

  /** Settlement report (summary + one line per payment/refund). */
  @Get(':id/report.csv')
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV settlement report', schema: { type: 'string' } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const merchant = await this.merchants.mine(user.id);
    const s = await this.settlements.getWithLines(merchant.id, id);
    return new StreamableFile(Buffer.from(settlementReportCsv(s, s.lines, merchant.businessName), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="settlement-${s.id}.csv"`,
    });
  }
}

@ApiTags('admin / settlements')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/settlements')
export class AdminSettlementsController {
  constructor(private readonly settlements: SettlementService) {}

  /** Run the T+N settlement batch now (idempotent: already-settled items are never picked twice). */
  @Post('run')
  @HttpCode(200)
  @ApiOkResponse({ type: SettlementRunDto })
  async run(@Body() dto: RunSettlementDto): Promise<SettlementRunDto> {
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    const created = await this.settlements.runBatch(asOf);
    return { asOf: asOf.toISOString(), settlements: created.map((s) => settlementView(s)) };
  }
}

@Module({
  imports: [LedgerModule, FundingModule, MerchantsModule],
  controllers: [MerchantSettlementsController, AdminSettlementsController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
