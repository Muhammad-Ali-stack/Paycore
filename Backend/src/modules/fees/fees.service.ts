import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Currency, FeeRule } from '@prisma/client';
import { moneyView } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { FeeRuleDto } from './fees.dto';
import { FeeProduct, FeeRuleValues, computeFee } from './fee.policy';

export function feeRuleView(r: FeeRule): FeeRuleDto {
  return {
    product: r.product,
    currency: r.currency,
    bps: r.bps,
    fixed: moneyView(r.fixed, r.currency),
    min: moneyView(r.min, r.currency),
    max: r.max === null ? null : moneyView(r.max, r.currency),
  };
}

/** Fee schedule (reference data in `fee_rules`, seeded and changed only by migrations). */
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  async rule(product: FeeProduct, currency: Currency, tx: Tx = this.prisma): Promise<FeeRuleValues> {
    const row = await tx.feeRule.findUnique({ where: { product_currency: { product, currency } } });
    // No rule configured => free. Explicit rows exist for every product/currency after migrations.
    if (!row) return { bps: 0, fixed: 0n, min: 0n, max: null };
    return { bps: row.bps, fixed: row.fixed, min: row.min, max: row.max };
  }

  async fee(product: FeeProduct, currency: Currency, amount: bigint, tx: Tx = this.prisma): Promise<bigint> {
    return computeFee(await this.rule(product, currency, tx), amount);
  }

  list(): Promise<FeeRule[]> {
    return this.prisma.feeRule.findMany({ orderBy: [{ product: 'asc' }, { currency: 'asc' }] });
  }
}

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /** The fee schedule applied to transfers, QR payments and funding. */
  @Get()
  @ApiOkResponse({ type: [FeeRuleDto] })
  async list(): Promise<FeeRuleDto[]> {
    return (await this.fees.list()).map(feeRuleView);
  }
}

@Module({
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
