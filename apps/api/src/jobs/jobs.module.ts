import { Module } from '@nestjs/common';
import { BookingsModule } from '../modules/bookings/bookings.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import { PaymentCbProcessor } from './payment-cb.processor';

/** Background workers (BullMQ). Kept out of feature modules so HTTP stays fast. */
@Module({
  imports: [BookingsModule, PaymentsModule],
  providers: [BookingExpiryProcessor, PaymentCbProcessor],
})
export class JobsModule {}
