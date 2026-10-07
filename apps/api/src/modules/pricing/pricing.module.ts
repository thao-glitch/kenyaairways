import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';

/** Configurable tax/fee pricing (DB rules, per route type). */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
