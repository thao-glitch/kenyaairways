import { Module } from '@nestjs/common';
import { getEnv } from '../../config/env';
import { RedisService } from '../../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PaymentsController } from './payments.controller';
import { PaymentsCbController } from './payments-cb.controller';
import { PaymentsService } from './payments.service';
import { CallbackIpGuard } from './callback-ip.guard';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { createPaymentProvider } from './providers/provider.factory';

/**
 * Money movement: STK push / intents, idempotent callback processing,
 * C2B matching, reconciliation and FINANCE-gated refunds.
 */
@Module({
  imports: [BookingsModule, AuthModule, RealtimeModule],
  controllers: [PaymentsController, PaymentsCbController],
  providers: [
    PaymentsService,
    CallbackIpGuard,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (redis: RedisService) => createPaymentProvider(getEnv(), redis),
      inject: [RedisService],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
