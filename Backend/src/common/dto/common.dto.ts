import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';

/** Money is always a decimal string in major units plus the exact integer minor units. */
export class MoneyDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  /** Decimal string in major units, e.g. "1250.50" */
  @ApiProperty({ example: '1250.50' })
  amount!: string;

  /** Integer minor units as a string, e.g. "125050" */
  @ApiProperty({ example: '125050' })
  amountMinor!: string;
}

export class PartyDto {
  @ApiProperty({ enum: ['USER', 'MERCHANT'] })
  type!: 'USER' | 'MERCHANT';

  /** Privacy-preserving name, e.g. "Ali K." for users or the business name for merchants */
  displayName!: string;

  @ApiPropertyOptional()
  username?: string;

  @ApiPropertyOptional()
  merchantId?: string;

  @ApiPropertyOptional()
  outletName?: string;
}

export class TimelineEntryDto {
  status!: string;

  /** ISO-8601 UTC */
  at!: string;

  @ApiPropertyOptional()
  reason?: string;
}

export class ErrorBodyDto {
  code!: string;
  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;

  correlationId!: string;
}

export class ErrorResponseDto {
  error!: ErrorBodyDto;
}
