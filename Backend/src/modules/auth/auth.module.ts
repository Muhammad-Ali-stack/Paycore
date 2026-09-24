import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OTP_PROVIDER, SimulatedOtpProvider } from './otp/otp.provider';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    OtpService,
    PinService,
    SimulatedOtpProvider,
    { provide: OTP_PROVIDER, useExisting: SimulatedOtpProvider },
  ],
  exports: [PinService, TokenService, SimulatedOtpProvider],
})
export class AuthModule {}
