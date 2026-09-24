import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { E164_PATTERN, PASSWORD_PATTERN, PIN_PATTERN } from '../credentials.policy';

const PHONE_MSG = 'phone must be in E.164 format, e.g. +923001234567';
const PASSWORD_MSG = 'password must be 10-128 chars and contain at least one letter and one digit';
const PIN_MSG = 'pin must be 4-6 digits';

export class RegisterDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;

  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MSG })
  password!: string;

  @IsString()
  @Length(2, 120)
  fullName!: string;

  /** ADMIN accounts cannot self-register. */
  @IsOptional()
  @IsIn(['CONSUMER', 'MERCHANT'])
  role?: 'CONSUMER' | 'MERCHANT';
}

export class VerifyPhoneDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class ResendOtpDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;
}

export class LoginDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;

  @IsString()
  @Length(1, 128)
  password!: string;

  /** Stable client-generated device identifier. */
  @IsString()
  @Length(1, 128)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  deviceName?: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 512)
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;
}

export class ResetPasswordDto {
  @Matches(E164_PATTERN, { message: PHONE_MSG })
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MSG })
  newPassword!: string;
}

export class SetPinDto {
  /** Current account password, to prove possession before setting a PIN. */
  @IsString()
  @Length(1, 128)
  password!: string;

  @Matches(PIN_PATTERN, { message: PIN_MSG })
  pin!: string;
}

export class ChangePinDto {
  @Matches(PIN_PATTERN, { message: PIN_MSG })
  currentPin!: string;

  @Matches(PIN_PATTERN, { message: PIN_MSG })
  newPin!: string;
}

// ─────────────── responses ───────────────

export class RegisterResponseDto {
  userId!: string;
  otpExpiresAt!: string;

  /** Only when OTP_DEV_ECHO=true (never in production) */
  @ApiPropertyOptional()
  devOtp?: string;
}

export class VerifyPhoneResponseDto {
  verified!: boolean;
}

export class OtpSentResponseDto {
  sent!: boolean;

  @ApiPropertyOptional()
  otpExpiresAt?: string;

  /** Only when OTP_DEV_ECHO=true (never in production) */
  @ApiPropertyOptional()
  devOtp?: string;
}

export class TokenPairDto {
  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';

  accessToken!: string;

  /** seconds */
  accessTokenExpiresIn!: number;

  refreshToken!: string;
  refreshTokenExpiresAt!: string;
  sessionId!: string;
}

export class SessionDto {
  id!: string;
  deviceId!: string;

  @ApiProperty({ type: String, nullable: true })
  deviceName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  userAgent!: string | null;

  @ApiProperty({ type: String, nullable: true })
  ipAddress!: string | null;

  createdAt!: string;
  lastUsedAt!: string;
  current!: boolean;
}

export class ResetPasswordResponseDto {
  reset!: boolean;
}

export class PinSetResponseDto {
  pinSet!: boolean;
}
