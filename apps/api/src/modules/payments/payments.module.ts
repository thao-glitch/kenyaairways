import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PaymentsController } from './payments.controller';
import { PaymentsCbController } from './payments-cb.controller';
import { PaymentConfigController } from './payment-config.controller';
import { PaymentsService } from './payments.service';
import { CallbackIpGuard } from './callback-ip.guard';
import { MethodConfigService } from './config/method-config.service';
import { PaymentProviderRegistry } from './config/payment-provider.registry';

/**
 * Money movement: STK push / intents, idempotent callback processing,
 * C2B matching, reconciliation and FINANCE-gated refunds. Provider
 * credentials/method selection resolve through MethodConfigService
 * (env defaults + admin "payment plans" overrides) and
 * PaymentProviderRegistry — edits apply within the config TTL without a
 * restart and never disturb in-flight payments.
 */
@Module({
  imports: [BookingsModule, AuthModule, RealtimeModule],
  controllers: [PaymentsController, PaymentsCbController, PaymentConfigController],
  providers: [PaymentsService, CallbackIpGuard, MethodConfigService, PaymentProviderRegistry],
  exports: [PaymentsService, MethodConfigService],
})
export class PaymentsModule {}
