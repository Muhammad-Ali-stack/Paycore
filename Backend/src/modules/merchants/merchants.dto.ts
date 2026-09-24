import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, KybTier, MerchantStatus, PaymentStatus, RefundStatus, ResourceStatus, SettlementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from '../../common/dto/common.dto';
import { AMOUNT_MSG, AMOUNT_PATTERN } from '../transfers/transfers.dto';

export class BankAccountDto {
  /** IBAN, e.g. PK36SCBL0000001123456702 */
  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, { message: 'iban must be a valid IBAN (upper-case, no spaces)' })
  iban!: string;

  @IsString()
  @Length(2, 120)
  accountTitle!: string;

  @IsString()
  @Length(2, 120)
  bankName!: string;
}

export class CreateMerchantDto {
  @IsString()
  @Length(2, 120)
  businessName!: string;

  /** ISO 18245 merchant category code, 4 digits (e.g. 5812 restaurants) */
  @Matches(/^\d{4}$/, { message: 'category must be a 4-digit MCC' })
  category!: string;

  @IsString()
  @Length(3, 64)
  registrationNumber!: string;

  @IsEnum(Currency)
  settlementCurrency!: Currency;

  @ValidateNested()
  @Type(() => BankAccountDto)
  settlementBank!: BankAccountDto;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;
}

export class CreateOutletDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 300)
  address?: string;
}

export class CreateTerminalDto {
  @IsString()
  @Length(1, 60)
  label!: string;
}

export class CreateDynamicQrDto {
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  @IsUUID()
  outletId?: string;

  @IsOptional()
  @IsUUID()
  terminalId?: string;

  /** Your order/invoice reference, shown to the payer and in reports */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reference?: string;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(3600)
  expiresInSeconds!: number;
}

export class MerchantPaymentsQuery {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Matches the payment reference or id */
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

export class CreateRefundDto {
  /** Defaults to the full remaining refundable amount */
  @IsOptional()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount?: string;

  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class DashboardQuery {
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class AdminMerchantsQuery {
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;

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

export class SetPricingDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  mdrBps!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  settlementDelayDays!: number;
}

export class ListQuery {
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

// ─────────────── responses ───────────────

export class MerchantDto {
  id!: string;
  businessName!: string;
  category!: string;

  @ApiProperty({ enum: MerchantStatus, enumName: 'MerchantStatus' })
  status!: MerchantStatus;

  @ApiProperty({ enum: KybTier, enumName: 'KybTier' })
  kybTier!: KybTier;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  settlementCurrency!: Currency;

  settlementDelayDays!: number;
  mdrBps!: number;
  createdAt!: string;
}

export class MerchantPageDto {
  @ApiProperty({ type: [MerchantDto] })
  items!: MerchantDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class StaticQrDto {
  qrId!: string;
  payload!: string;
}

export class OutletDto {
  id!: string;
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ enum: ResourceStatus, enumName: 'ResourceStatus' })
  status!: ResourceStatus;

  staticQr!: StaticQrDto;
  createdAt!: string;
}

export class TerminalDto {
  id!: string;
  label!: string;

  @ApiProperty({ enum: ResourceStatus, enumName: 'ResourceStatus' })
  status!: ResourceStatus;

  createdAt!: string;
}

export class RefundDto {
  id!: string;
  paymentId!: string;
  amount!: MoneyDto;

  @ApiProperty({ enum: RefundStatus, enumName: 'RefundStatus' })
  status!: RefundStatus;

  reason!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  failureReason?: string | null;

  createdAt!: string;
}

export class SettlementLineDto {
  @ApiProperty({ enum: ['PAYMENT', 'REFUND'] })
  kind!: string;

  @ApiProperty({ type: String, nullable: true })
  paymentId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  refundId!: string | null;

  gross!: MoneyDto;
  mdr!: MoneyDto;
  net!: MoneyDto;
  occurredAt!: string;
}

export class SettlementDto {
  id!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  periodStart!: string;
  periodEnd!: string;
  gross!: MoneyDto;
  mdr!: MoneyDto;
  refunds!: MoneyDto;
  net!: MoneyDto;

  @ApiProperty({ enum: SettlementStatus, enumName: 'SettlementStatus' })
  status!: SettlementStatus;

  @ApiProperty({ type: String, nullable: true })
  paidAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankReference!: string | null;

  @ApiPropertyOptional({ type: [SettlementLineDto] })
  lines?: SettlementLineDto[];
}

export class SettlementPageDto {
  @ApiProperty({ type: [SettlementDto] })
  items!: SettlementDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class DashboardTodayDto {
  volume!: MoneyDto;
  count!: number;
  refunds!: MoneyDto;
}

export class DashboardPointDto {
  /** YYYY-MM-DD (UTC) */
  date!: string;
  volume!: MoneyDto;
  count!: number;
}

export class MerchantDashboardDto {
  today!: DashboardTodayDto;

  /** Unsettled net balance owed to the merchant */
  pendingSettlement!: MoneyDto;

  @ApiProperty({ type: SettlementDto, nullable: true })
  lastSettlement!: SettlementDto | null;

  /** Last 14 days, oldest first */
  @ApiProperty({ type: [DashboardPointDto] })
  series!: DashboardPointDto[];
}

export class SettlementRunDto {
  asOf!: string;

  @ApiProperty({ type: [SettlementDto] })
  settlements!: SettlementDto[];
}
