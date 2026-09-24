import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { MoneyDto, PartyDto } from '../../common/dto/common.dto';

export const ACTIVITY_TYPES = [
  'P2P',
  'P2P_FX',
  'REQUEST',
  'QR_MERCHANT',
  'QR_P2P',
  'REFUND',
  'TOPUP',
  'WITHDRAWAL',
  'DEPOSIT',
  'TRANSFER',
  'FX_CONVERSION',
  'REVERSAL',
  'ADJUSTMENT',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export class ActivityQuery {
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: ActivityType;

  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: 'IN' | 'OUT';

  /** ISO-8601, inclusive */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO-8601, exclusive */
  @IsOptional()
  @IsDateString()
  to?: string;

  /** Free-text search over descriptions */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  q?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class StatementQuery {
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Only csv for now (PDF comes later) */
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}

export class ActivityItemDto {
  /** Posting id (unique per wallet movement) */
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  paymentId!: string | null;

  /** Journal entry id */
  transactionId!: string;

  @ApiProperty({ enum: ACTIVITY_TYPES })
  type!: string;

  title!: string;

  @ApiProperty({ type: PartyDto, nullable: true })
  counterparty!: PartyDto | null;

  @ApiProperty({ enum: ['IN', 'OUT'] })
  direction!: 'IN' | 'OUT';

  amount!: MoneyDto;

  @ApiProperty({ type: MoneyDto, nullable: true })
  fee!: MoneyDto | null;

  balanceAfter!: MoneyDto;

  /** Payment / funding status, or COMPLETED for plain ledger entries */
  status!: string;

  createdAt!: string;
}

export class ActivityPageDto {
  @ApiProperty({ type: [ActivityItemDto] })
  items!: ActivityItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
