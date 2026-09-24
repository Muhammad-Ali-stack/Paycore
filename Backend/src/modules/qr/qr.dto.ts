import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, QrKind, QrStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { MoneyDto, PartyDto } from '../../common/dto/common.dto';
import { PIN_PATTERN } from '../auth/credentials.policy';
import { AMOUNT_MSG, AMOUNT_PATTERN } from '../transfers/transfers.dto';

export class CreateReceiveQrDto {
  @IsEnum(Currency)
  currency!: Currency;

  /** Fixed amount (single-use, expires). Omit for a reusable "pay me any amount" code. */
  @IsOptional()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount?: string;
}

export class ResolveQrDto {
  /** The opaque payload exactly as scanned (PC1.<claims>.<signature>) */
  @IsString()
  @Length(10, 2048)
  payload!: string;
}

export class PayQrDto {
  /** From POST /qr/resolve (short-lived, single use, bound to you, the payee, the amount and the fee) */
  @IsString()
  @Length(10, 4096)
  previewToken!: string;

  @IsUUID()
  fromWalletId!: string;

  /** Required when the preview amount is null (payer-entered amount); must match otherwise. */
  @IsOptional()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MSG })
  amount?: string;

  @Matches(PIN_PATTERN, { message: 'pin must be 4-6 digits' })
  pin!: string;
}

// ─────────────── responses ───────────────

export class ReceiveQrDto {
  qrId!: string;
  payload!: string;

  @ApiProperty({ type: String, nullable: true })
  expiresAt!: string | null;
}

export class QrPreviewDto {
  previewToken!: string;

  @ApiProperty({ enum: QrKind, enumName: 'QrKind' })
  kind!: QrKind;

  payee!: PartyDto;

  /** null: the payer enters the amount */
  @ApiProperty({ type: MoneyDto, nullable: true })
  amount!: MoneyDto | null;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  /** Fee charged to the payer (null when the amount is payer-entered; see GET /fees) */
  @ApiProperty({ type: MoneyDto, nullable: true })
  fee!: MoneyDto | null;

  /** When the QR itself expires (null = reusable static code) */
  @ApiProperty({ type: String, nullable: true })
  expiresAt!: string | null;

  /** When this preview token expires */
  previewExpiresAt!: string;
}

export class DynamicQrDto {
  qrId!: string;
  payload!: string;
  amount!: MoneyDto;
  expiresAt!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAID', 'EXPIRED'] })
  status!: QrStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  paymentId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  reference?: string | null;
}
