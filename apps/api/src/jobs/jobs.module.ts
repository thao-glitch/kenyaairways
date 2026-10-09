import { Module } from '@nestjs/common';
import { BookingsModule } from '../modules/bookings/bookings.module';
import { OpsModule } from '../modules/ops/ops.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import { ManifestDispatchProcessor } from './manifest-dispatch.processor';
import { PaymentCbProcessor } from './payment-cb.processor';

/** Background workers (BullMQ). Kept out of feature modules so HTTP stays fast. */
@Module({
  imports: [BookingsModule, PaymentsModule, OpsModule],
  providers: [BookingExpiryProcessor, PaymentCbProcessor, ManifestDispatchProcessor],
})
export class JobsModule {}
