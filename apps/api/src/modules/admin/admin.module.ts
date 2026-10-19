import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminFlightsController } from './admin-flights.controller';

/**
 * Staff console backend: fare management (see and move every price live) and
 * the assistance desk (find any booking, take payment directly, issue).
 * PrismaService is global; PaymentsModule brings the settlement funnel.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [AdminFlightsController, AdminBookingsController],
})
export class AdminModule {}
