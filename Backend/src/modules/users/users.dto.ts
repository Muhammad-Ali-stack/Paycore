import { ApiProperty } from '@nestjs/swagger';
import { Currency, KycTier, Role, UserStatus } from '@prisma/client';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export const USERNAME_INPUT_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  /** 3-20 chars of [a-z0-9_]; case-insensitive (stored lower-case) and unique. */
  @IsOptional()
  @Matches(USERNAME_INPUT_PATTERN, { message: 'username must be 3-20 characters of a-z, 0-9 or _' })
  username?: string;
}

export class SuspendUserDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class FindUserQuery {
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be E.164, e.g. +923001234567' })
  phone!: string;
}

export class LookupQuery {
  /** A phone number in E.164 (`+923001234567`, URL-encode the `+` as %2B) or a username (`@ali_k` or `ali_k`) */
  @IsString()
  @Length(3, 32)
  q!: string;
}

// ─────────────── responses ───────────────

export class UserDto {
  id!: string;
  phone!: string;
  fullName!: string;

  @ApiProperty({ type: String, nullable: true })
  username!: string | null;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' })
  status!: UserStatus;

  @ApiProperty({ enum: KycTier, enumName: 'KycTier' })
  kycTier!: KycTier;

  phoneVerified!: boolean;
  pinSet!: boolean;
  createdAt!: string;
}

export class UserLookupDto {
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  username!: string | null;

  /** First name and last initial, e.g. "Ali K." */
  displayName!: string;

  /** e.g. "+92300****567" */
  phoneMasked!: string;

  /** Currencies the user can receive in (active wallets) */
  @ApiProperty({ enum: Currency, enumName: 'Currency', isArray: true })
  wallets!: Currency[];
}
