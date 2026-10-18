import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

/**
 * Site appearance (theme + admin-managed photographs) plus the public
 * paybill surfaced from the payment plan. Imports PaymentsModule purely for
 * MethodConfigService — the shortcode is configured there.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteModule {}
