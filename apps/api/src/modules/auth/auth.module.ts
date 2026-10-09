import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { SmsModule } from '../notifications/sms.module';

/**
 * Authentication: registration, login, refresh rotation, logout, OTP and the
 * token service used by the global JwtAuthGuard.
 */
@Module({
  imports: [SmsModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService],
  exports: [TokenService, OtpService],
})
export class AuthModule {}
