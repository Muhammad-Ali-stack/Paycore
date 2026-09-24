import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { AuthRateLimit } from '../../common/throttling/throttling';
import { AuthService } from './auth.service';
import {
  ChangePinDto,
  ForgotPasswordDto,
  LoginDto,
  OtpSentResponseDto,
  PinSetResponseDto,
  RegisterResponseDto,
  ResetPasswordResponseDto,
  SessionDto,
  TokenPairDto,
  VerifyPhoneResponseDto,
  RefreshDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  SetPinDto,
  VerifyPhoneDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthRateLimit()
  @Post('register')
  @ApiCreatedResponse({ type: RegisterResponseDto })
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.auth.register(dto);
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('verify-phone')
  @ApiOkResponse({ type: VerifyPhoneResponseDto })
  verifyPhone(@Body() dto: VerifyPhoneDto): Promise<VerifyPhoneResponseDto> {
    return this.auth.verifyPhone(dto.phone, dto.code);
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('otp/resend')
  @ApiOkResponse({ type: OtpSentResponseDto })
  resend(@Body() dto: ResendOtpDto): Promise<OtpSentResponseDto> {
    return this.auth.resendRegistrationOtp(dto.phone);
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('login')
  @ApiOkResponse({ type: TokenPairDto })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<TokenPairDto> {
    return this.auth.login({ ...dto, userAgent: req.headers['user-agent'], ipAddress: req.ip });
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('refresh')
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('password/forgot')
  @ApiOkResponse({ type: OtpSentResponseDto })
  forgot(@Body() dto: ForgotPasswordDto): Promise<OtpSentResponseDto> {
    return this.auth.forgotPassword(dto.phone);
  }

  @Public()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('password/reset')
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  reset(@Body() dto: ResetPasswordDto): Promise<ResetPasswordResponseDto> {
    return this.auth.resetPassword(dto.phone, dto.code, dto.newPassword);
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('logout')
  @ApiNoContentResponse({ description: 'Session revoked' })
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOkResponse({ type: [SessionDto] })
  sessions(@CurrentUser() user: AuthUser): Promise<SessionDto[]> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Delete('sessions/:id')
  @ApiNoContentResponse({ description: 'Session revoked' })
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.auth.revokeSession(user.id, id);
  }

  @ApiBearerAuth()
  @AuthRateLimit()
  @HttpCode(200)
  @Post('pin')
  @ApiOkResponse({ type: PinSetResponseDto })
  setPin(@CurrentUser() user: AuthUser, @Body() dto: SetPinDto): Promise<PinSetResponseDto> {
    return this.auth.setPin(user.id, dto.password, dto.pin);
  }

  @ApiBearerAuth()
  @AuthRateLimit()
  @Put('pin')
  @ApiOkResponse({ type: PinSetResponseDto })
  changePin(@CurrentUser() user: AuthUser, @Body() dto: ChangePinDto): Promise<PinSetResponseDto> {
    return this.auth.changePin(user.id, dto.currentPin, dto.newPin);
  }
}
