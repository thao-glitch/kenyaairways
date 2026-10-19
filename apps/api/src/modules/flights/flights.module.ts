import { Module } from '@nestjs/common';
import { FareClassesController, FleetController, FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { PricingModule } from '../pricing/pricing.module';

/** Search, flight detail, fares and fare classes. */
@Module({
  imports: [PricingModule],
  controllers: [FlightsController, FareClassesController, FleetController],
  providers: [FlightsService],
  exports: [FlightsService],
})
export class FlightsModule {}
