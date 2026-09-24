import { ApiProperty } from '@nestjs/swagger';
import { AccountOwnerType, AccountType, Currency, EntryType, NormalBalance } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import { MoneyDto } from '../../common/dto/common.dto';

export class ReverseEntryDto {
  /** Why the entry is being reversed (kept on the reversal entry for audit). */
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class LedgerAccountDto {
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  code!: string | null;

  name!: string;

  @ApiProperty({ enum: AccountType, enumName: 'AccountType' })
  type!: AccountType;

  @ApiProperty({ enum: NormalBalance, enumName: 'NormalBalance' })
  normalBalance!: NormalBalance;

  @ApiProperty({ enum: AccountOwnerType, enumName: 'AccountOwnerType' })
  ownerType!: AccountOwnerType;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  /** Cached balance on the account's normal side */
  balance!: MoneyDto;

  version!: number;
}

export class LedgerAccountDetailDto extends LedgerAccountDto {
  /** Recomputed from postings (source of truth) */
  derivedBalance!: MoneyDto;
}

export class PostingDto {
  id!: string;
  accountId!: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  direction!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  amount!: string;
  amountMinor!: string;
  balanceAfter!: string;
}

export class JournalEntryDto {
  id!: string;

  @ApiProperty({ enum: EntryType, enumName: 'EntryType' })
  type!: EntryType;

  description!: string;

  @ApiProperty({ type: String, nullable: true })
  reversalOfId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  initiatedBy!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: unknown;

  createdAt!: string;

  @ApiProperty({ type: [PostingDto] })
  postings!: PostingDto[];
}

export class UnbalancedEntryDto {
  entryId!: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  net!: string;
}

export class NetByCurrencyDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  net!: string;
  postings!: string;
}

export class BalanceMismatchDto {
  accountId!: string;
  cached!: string;
  derived!: string;
}

export class TrialBalanceDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;

  debitNormal!: string;
  creditNormal!: string;
}

export class IntegrityReportDto {
  healthy!: boolean;

  @ApiProperty({ type: [UnbalancedEntryDto] })
  unbalancedEntries!: UnbalancedEntryDto[];

  @ApiProperty({ type: [NetByCurrencyDto] })
  netByCurrency!: NetByCurrencyDto[];

  @ApiProperty({ type: [BalanceMismatchDto] })
  balanceCacheMismatches!: BalanceMismatchDto[];

  @ApiProperty({ type: [TrialBalanceDto] })
  trialBalance!: TrialBalanceDto[];
}
