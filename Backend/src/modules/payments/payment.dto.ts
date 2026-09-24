import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus, PaymentType } from '@prisma/client';
import { MoneyDto, PartyDto, TimelineEntryDto } from '../../common/dto/common.dto';

export class PaymentDto {
  id!: string;

  @ApiProperty({ enum: PaymentType, enumName: 'PaymentType' })
  type!: PaymentType;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  /** Amount sent, in the payer's currency */
  amount!: MoneyDto;

  /** Fee charged to the payer (payer's currency) */
  fee!: MoneyDto;

  /** amount + fee */
  totalDebit!: MoneyDto;

  /** Cross-currency payments: what the payee received */
  @ApiPropertyOptional({ type: MoneyDto })
  received?: MoneyDto;

  payer!: PartyDto;
  payee!: PartyDto;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  journalEntryId!: string | null;

  createdAt!: string;

  @ApiProperty({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiProperty({ type: [TimelineEntryDto] })
  timeline!: TimelineEntryDto[];
}

/** A payment as seen by the merchant: adds the MDR fee, net amount and refunds. */
export class MerchantPaymentDto extends PaymentDto {
  mdrFee!: MoneyDto;
  net!: MoneyDto;
  refundedAmount!: MoneyDto;
}

export class PaymentPageDto {
  @ApiProperty({ type: [PaymentDto] })
  items!: PaymentDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class MerchantPaymentPageDto {
  @ApiProperty({ type: [MerchantPaymentDto] })
  items!: MerchantPaymentDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
