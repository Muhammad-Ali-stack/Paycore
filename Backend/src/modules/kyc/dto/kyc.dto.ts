import { ApiProperty } from '@nestjs/swagger';
import { Currency, KycDocumentType, KycSubmissionStatus, KycTier } from '@prisma/client';
import { MoneyDto } from '../../../common/dto/common.dto';
import { IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class SubmitKycDto {
  @IsIn(['TIER_1', 'TIER_2', 'TIER_3'])
  targetTier!: Exclude<KycTier, 'TIER_0'>;

  @IsEnum(KycDocumentType)
  documentType!: KycDocumentType;

  @IsString()
  @Length(5, 40)
  documentNumber!: string;

  /** Reference to an uploaded document image in object storage. */
  @IsOptional()
  @IsString()
  @Length(1, 256)
  documentRef?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @Length(5, 300)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  businessName?: string;
}

export class ApproveKycDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class RejectKycDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class ListSubmissionsQuery {
  @IsOptional()
  @IsEnum(KycSubmissionStatus)
  status?: KycSubmissionStatus;
}

// ─────────────── responses ───────────────

export class TierLimitDto {
  @ApiProperty({ enum: KycTier, enumName: 'KycTier' })
  tier!: KycTier;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  permitted!: boolean;
  perTransaction!: MoneyDto;
  daily!: MoneyDto;
  monthly!: MoneyDto;
  maxBalance!: MoneyDto;
}

export class KycSubmissionDto {
  id!: string;
  userId!: string;

  @ApiProperty({ enum: KycTier, enumName: 'KycTier' })
  targetTier!: KycTier;

  @ApiProperty({ enum: KycSubmissionStatus, enumName: 'KycSubmissionStatus' })
  status!: KycSubmissionStatus;

  @ApiProperty({ enum: KycDocumentType, enumName: 'KycDocumentType' })
  documentType!: KycDocumentType;

  documentNumberLast4!: string;

  @ApiProperty({ type: String, nullable: true })
  documentRef!: string | null;

  @ApiProperty({ type: String, nullable: true })
  businessName!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  verificationResult!: unknown;

  @ApiProperty({ type: String, nullable: true })
  reviewedById!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reviewedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rejectionReason!: string | null;

  createdAt!: string;
}

export class KycMeDto {
  @ApiProperty({ enum: KycTier, enumName: 'KycTier' })
  tier!: KycTier;

  @ApiProperty({ type: [TierLimitDto] })
  limits!: TierLimitDto[];

  @ApiProperty({ type: [KycSubmissionDto] })
  submissions!: KycSubmissionDto[];
}

export class KycAuditLogDto {
  id!: string;
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  submissionId!: string | null;

  /** null = SYSTEM (automated decision) */
  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  action!: string;

  @ApiProperty({ enum: KycTier, enumName: 'KycTier', nullable: true })
  fromTier!: KycTier | null;

  @ApiProperty({ enum: KycTier, enumName: 'KycTier', nullable: true })
  toTier!: KycTier | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  details!: unknown;

  createdAt!: string;
}
