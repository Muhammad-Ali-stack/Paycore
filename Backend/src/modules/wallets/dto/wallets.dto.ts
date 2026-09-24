import { ApiProperty } from '@nestjs/swagger';
import { Currency, EntryType, FxQuoteStatus, WalletStatus } from '@prisma/client';
import { MoneyDto } from '../../../common/dto/common.dto';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { PIN_PATTERN } from '../../auth/credentials.policy';

/** Decimal string in major units, e.g. "1250.50". Precision is checked per currency. */
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,8})?$/;
const AMOUNT_MSG = 'amount must be a positive decimal string, e.g. "1250.50"';

export class CreateWalletDto {
  @IsEnum(Currency)
  currency!: Currency;
}

export class DepositDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;
}

export class WithdrawDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;
}

export class HistoryQuery {
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

export class SetWalletStatusDto {
  @IsEnum(WalletStatus)
  status!: WalletStatus;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class CreateQuoteDto {
  @IsEnum(Currency)
  fromCurrency!: Currency;

  @IsEnum(Currency)
  toCurrency!: Currency;

  /** Amount of `fromCurrency` to convert (fee is charged on top). */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  sellAmount!: string;
}

export class ExecuteConversionDto {
  @IsUUID()
  quoteId!: string;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;
}

// ─────────────── responses ───────────────

export class WalletDto {
  id!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  @ApiProperty({ enum: WalletStatus, enumName: 'WalletStatus' })
  status!: WalletStatus;

  balance!: MoneyDto;
  createdAt!: string;
}

export class AdminWalletDto extends WalletDto {
  userId!: string;
  ledgerAccountId!: string;
}

export class WalletHistoryItemDto {
  postingId!: string;
  transactionId!: string;

  @ApiProperty({ enum: EntryType, enumName: 'EntryType' })
  type!: EntryType;

  description!: string;

  @ApiProperty({ enum: ['IN', 'OUT'] })
  direction!: 'IN' | 'OUT';

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  amount!: string;
  amountMinor!: string;
  balanceAfter!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: unknown;

  createdAt!: string;
}

export class WalletHistoryPageDto {
  @ApiProperty({ type: [WalletHistoryItemDto] })
  items!: WalletHistoryItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class TransactionLegDto {
  walletId!: string;

  @ApiProperty({ enum: ['IN', 'OUT'] })
  direction!: 'IN' | 'OUT';

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  amount!: string;
  amountMinor!: string;
  balanceAfter!: string;
}

/** A journal entry as seen by a wallet owner (only the viewer's own legs). */
export class TransactionDto {
  id!: string;

  @ApiProperty({ enum: EntryType, enumName: 'EntryType' })
  type!: EntryType;

  @ApiProperty({ enum: ['COMPLETED'] })
  status!: 'COMPLETED';

  description!: string;

  @ApiProperty({ type: String, nullable: true })
  reversalOfId!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: unknown;

  createdAt!: string;

  @ApiProperty({ type: [TransactionLegDto] })
  legs!: TransactionLegDto[];
}

export class FxPairDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  from!: Currency;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  to!: Currency;

  midRate!: string;
  customerRate!: string;
}

export class FxRatesTableDto {
  spreadBps!: number;
  feeBps!: number;

  @ApiProperty({ type: [FxPairDto] })
  pairs!: FxPairDto[];
}

export class FxQuoteDto {
  id!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  fromCurrency!: Currency;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  toCurrency!: Currency;

  sell!: MoneyDto;
  fee!: MoneyDto;
  totalDebit!: MoneyDto;
  buy!: MoneyDto;
  midRate!: string;
  customerRate!: string;
  spreadBps!: number;
  feeBps!: number;

  @ApiProperty({ enum: FxQuoteStatus, enumName: 'FxQuoteStatus' })
  status!: FxQuoteStatus;

  expiresAt!: string;

  @ApiProperty({ type: String, nullable: true })
  journalEntryId!: string | null;
}

export class ConversionResultDto {
  quote!: FxQuoteDto;
  transaction!: TransactionDto;
}
