import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AmountSide, Currency, PaymentRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, PartyDto } from '../../common/dto/common.dto';
import { E164_PATTERN, PIN_PATTERN } from '../auth/credentials.policy';
import { USERNAME_INPUT_PATTERN } from '../users/users.dto';

export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,8})?$/;
export const AMOUNT_MSG = 'amount must be a positive decimal string, e.g. "1250.50"';
const USERNAME_IN = /^@?[A-Za-z0-9_]{3,20}$/;

/** Exactly one of phone or username. */
export class RecipientDto {
  @IsOptional()
  @Matches(E164_PATTERN, { message: 'to.phone must be E.164, e.g. +923001234567' })
  phone?: string;

  /** With or without a leading @ */
  @IsOptional()
  @Matches(USERNAME_IN, { message: 'to.username must be 3-20 characters of a-z, 0-9 or _' })
  username?: string;
}

export class CreateTransferQuoteDto {
  @IsUUID()
  fromWalletId!: string;

  @ValidateNested()
  @Type(() => RecipientDto)
  to!: RecipientDto;

  @IsEnum(Currency)
  toCurrency!: Currency;

  /** Decimal string; its currency is the source wallet's (SEND) or `toCurrency` (RECEIVE). */
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @IsEnum(AmountSide)
  amountSide!: AmountSide;
}

/**
 * Either `{quoteId, pin, note?}` (priced by POST /transfers/quotes, required for cross-currency)
 * or the direct same-currency form `{fromWalletId, toPhone | toUsername, amount, pin, note?}`.
 */
export class CreateTransferDto {
  @IsOptional()
  @IsUUID()
  quoteId?: string;

  @ValidateIf((o: CreateTransferDto) => !o.quoteId)
  @IsUUID()
  fromWalletId?: string;

  @IsOptional()
  @Matches(E164_PATTERN, { message: 'toPhone must be E.164' })
  toPhone?: string;

  @IsOptional()
  @Matches(USERNAME_IN, { message: 'toUsername must be 3-20 characters of a-z, 0-9 or _' })
  toUsername?: string;

  @ValidateIf((o: CreateTransferDto) => !o.quoteId)
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount?: string;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;

  @IsOptional()
  @IsString()
  @Length(1, 140)
  note?: string;
}

export class CreatePaymentRequestDto {
  @ValidateNested()
  @Type(() => RecipientDto)
  to!: RecipientDto;

  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  @IsString()
  @Length(1, 140)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}

export class ListPaymentRequestsQuery {
  @IsOptional()
  @IsIn(['INCOMING', 'OUTGOING'])
  direction?: 'INCOMING' | 'OUTGOING';

  @IsOptional()
  @IsEnum(PaymentRequestStatus)
  status?: PaymentRequestStatus;

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

export class AcceptPaymentRequestDto {
  @IsUUID()
  fromWalletId!: string;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;
}

// ─────────────── responses ───────────────

export class FxRatesDto {
  /** Mid-market rate, 8 decimal places */
  midRate!: string;
  /** Rate applied to the customer (mid less spread), 8 decimal places */
  customerRate!: string;
}

export class RecipientSummaryDto {
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  username!: string | null;
}

export class TransferQuoteDto {
  id!: string;
  send!: MoneyDto;
  receive!: MoneyDto;
  fee!: MoneyDto;
  totalDebit!: MoneyDto;

  /** null for same-currency quotes */
  @ApiProperty({ type: FxRatesDto, nullable: true })
  fx!: FxRatesDto | null;

  recipient!: RecipientSummaryDto;
  expiresAt!: string;
}

export class PaymentRequestDto {
  id!: string;
  requester!: PartyDto;
  payer!: PartyDto;
  amount!: MoneyDto;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ enum: PaymentRequestStatus, enumName: 'PaymentRequestStatus' })
  status!: PaymentRequestStatus;

  expiresAt!: string;

  @ApiProperty({ type: String, nullable: true })
  paymentId!: string | null;

  createdAt!: string;
}

export class PaymentRequestPageDto {
  @ApiProperty({ type: [PaymentRequestDto] })
  items!: PaymentRequestDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}

export { USERNAME_INPUT_PATTERN };
