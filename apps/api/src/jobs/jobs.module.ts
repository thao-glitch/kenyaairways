import { Module } from '@nestjs/common';
import { BookingsModule } from '../modules/bookings/bookings.module';
import { BookingExpiryProcessor } from './booking-expiry.processor';

/** Background workers (BullMQ). Kept out of feature modules so HTTP stays fast. */
@Module({
  imports: [BookingsModule],
  providers: [BookingExpiryProcessor],
})
export class JobsModule {}
