import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, FundingDirection, FundingMethod, FundingStatus, ReconciliationItemType, ReconciliationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { MoneyDto, TimelineEntryDto } from '../../common/dto/common.dto';
import { PIN_PATTERN } from '../auth/credentials.policy';
import { BankAccountDto } from '../merchants/merchants.dto';
import { AMOUNT_MSG, AMOUNT_PATTERN } from '../transfers/transfers.dto';

export class CreateTopupDto {
  @IsUUID()
  walletId!: string;

  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @IsEnum(FundingMethod)
  method!: FundingMethod;
}

export class CreateWithdrawalDto {
  @IsUUID()
  walletId!: string;

  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount!: BankAccountDto;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;
}

export class ListFundingQuery {
  @IsOptional()
  @IsEnum(FundingStatus)
  status?: FundingStatus;

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

export class SimulateBankDto {
  /** The funding transaction to resolve */
  @IsOptional()
  @IsUUID()
  fundingId?: string;

  /** Extension: resolve a merchant settlement payout instead (SUCCEEDED -> PAID) */
  @IsOptional()
  @IsUUID()
  settlementId?: string;

  @IsIn(['SUCCEEDED', 'FAILED', 'REVERSED'])
  outcome!: 'SUCCEEDED' | 'FAILED' | 'REVERSED';

  /** Deliver the webhook later (processed by the outbox relay / worker) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  delayMs?: number;
}

export class RunReconciliationDto {
  /** UTC business date, YYYY-MM-DD (default: yesterday) */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

// ─────────────── responses ───────────────

export class FundingInstructionsDto {
  bankName!: string;
  iban!: string;
  accountTitle!: string;
  /** Quote this reference in the transfer so the bank can match it */
  reference!: string;
}

export class FundingTransactionDto {
  id!: string;

  @ApiProperty({ enum: FundingDirection, enumName: 'FundingDirection' })
  direction!: FundingDirection;

  @ApiProperty({ enum: FundingMethod, enumName: 'FundingMethod' })
  method!: FundingMethod;

  @ApiProperty({ enum: FundingStatus, enumName: 'FundingStatus' })
  status!: FundingStatus;

  walletId!: string;
  amount!: MoneyDto;
  fee!: MoneyDto;

  @ApiProperty({ type: String, nullable: true })
  bankReference!: string | null;

  @ApiProperty({ type: FundingInstructionsDto, nullable: true })
  instructions!: FundingInstructionsDto | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  createdAt!: string;
  updatedAt!: string;

  @ApiProperty({ type: [TimelineEntryDto] })
  timeline!: TimelineEntryDto[];
}

export class FundingPageDto {
  @ApiProperty({ type: [FundingTransactionDto] })
  items!: FundingTransactionDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class WebhookReceiptDto {
  received!: boolean;
  duplicate!: boolean;

  @ApiProperty({ enum: ['APPLIED', 'DEFERRED', 'FLAGGED', 'IGNORED', 'UNMATCHED', 'DUPLICATE'] })
  outcome!: string;
}

export class SimulationResultDto {
  reference!: string;

  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED', 'REVERSED'] })
  outcome!: string;

  eventId!: string;

  /** false when delayMs > 0: the webhook is sent later by the worker */
  delivered!: boolean;

  @ApiProperty({ type: String, nullable: true })
  scheduledFor!: string | null;

  @ApiPropertyOptional({ type: WebhookReceiptDto })
  receipt?: WebhookReceiptDto;
}

export class ReconciliationItemDto {
  @ApiProperty({ enum: ReconciliationItemType, enumName: 'ReconciliationItemType' })
  type!: ReconciliationItemType;

  bankReference!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  /** Net movement per the bank statement (+ in / - out) */
  @ApiProperty({ type: MoneyDto, nullable: true })
  bankAmount!: MoneyDto | null;

  /** Net movement on BANK_CLEARING per the ledger */
  @ApiProperty({ type: MoneyDto, nullable: true })
  ledgerAmount!: MoneyDto | null;

  @ApiProperty({ type: String, nullable: true })
  fundingId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  settlementId!: string | null;
}

export class ReconciliationRunDto {
  id!: string;
  date!: string;

  @ApiProperty({ enum: ReconciliationStatus, enumName: 'ReconciliationStatus' })
  status!: ReconciliationStatus;

  matched!: number;
  missingInLedger!: number;
  missingInBank!: number;
  amountMismatches!: number;

  @ApiProperty({ type: [ReconciliationItemDto] })
  items!: ReconciliationItemDto[];

  createdAt!: string;

  @ApiProperty({ type: String, nullable: true })
  completedAt!: string | null;
}

export class ReconciliationRunPageDto {
  @ApiProperty({ type: [ReconciliationRunDto] })
  items!: ReconciliationRunDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
