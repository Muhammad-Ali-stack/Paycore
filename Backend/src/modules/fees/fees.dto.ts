import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { MoneyDto } from '../../common/dto/common.dto';

export class FeeRuleDto {
  @ApiProperty({ enum: ['P2P', 'P2P_FX', 'REQUEST', 'QR_P2P', 'QR_MERCHANT', 'TOPUP_BANK_TRANSFER', 'TOPUP_CARD', 'WITHDRAWAL'] })
  product!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  /** Percentage part in basis points (1 bp = 0.01%) */
  bps!: number;

  fixed!: MoneyDto;
  min!: MoneyDto;

  @ApiProperty({ type: MoneyDto, nullable: true })
  max!: MoneyDto | null;
}
