import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { InventoryService } from './inventory.service';

/** Booking lifecycle: holds, seat selection, cancellation, TTL expiry. */
@Module({
  imports: [PricingModule, RealtimeModule],
  controllers: [BookingsController],
  providers: [BookingsService, InventoryService],
  exports: [BookingsService, InventoryService],
})
export class BookingsModule {}
