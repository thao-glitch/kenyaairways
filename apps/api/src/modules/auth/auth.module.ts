import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { createSmsSender, SmsSender } from '../notifications/sms.sender';

/**
 * Authentication: registration, login, refresh rotation, logout, OTP and the
 * token service used by the global JwtAuthGuard.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    { provide: SmsSender, useFactory: createSmsSender },
  ],
  exports: [TokenService],
})
export class AuthModule {}
