import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights/flights.module';
import { PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';

/** Passenger fare tracking (Skyscanner price-alert style). */
@Module({
  imports: [FlightsModule],
  controllers: [PriceAlertsController],
  providers: [PriceAlertsService],
  exports: [PriceAlertsService],
})
export class PriceAlertsModule {}
