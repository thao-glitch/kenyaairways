import { Module } from '@nestjs/common';
import { BookingsModule } from '../modules/bookings/bookings.module';
import { OpsModule } from '../modules/ops/ops.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { PriceAlertsModule } from '../modules/price-alerts/price-alerts.module';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import { ManifestDispatchProcessor } from './manifest-dispatch.processor';
import { PaymentCbProcessor } from './payment-cb.processor';
import { PriceWatchProcessor } from './price-watch.processor';
import { RetentionProcessor } from './retention.processor';
import { RetentionService } from './retention.service';

/** Background workers (BullMQ). Kept out of feature modules so HTTP stays fast. */
@Module({
  imports: [BookingsModule, PaymentsModule, OpsModule, PriceAlertsModule],
  providers: [
    BookingExpiryProcessor,
    PaymentCbProcessor,
    ManifestDispatchProcessor,
    RetentionService,
    RetentionProcessor,
    PriceWatchProcessor,
  ],
  exports: [RetentionService],
})
export class JobsModule {}
