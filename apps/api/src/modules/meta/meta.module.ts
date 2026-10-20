import { Controller, Get, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MetaDto } from '@kenyaairways/shared';
import { getEnv } from '../../config/env';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('meta')
@ApiTags('meta')
export class MetaController {
  /** Public runtime configuration for the web app (never exposes secrets). */
  @Get()
  @ApiOperation({ summary: 'Public app configuration' })
  @ApiOkResponse({ description: 'Feature flags, limits and branding' })
  meta(): MetaDto {
    const env = getEnv();
    const mpesaMode =
      env.MPESA_MODE === 'mock'
        ? 'mock'
        : env.MPESA_ENV === 'production'
          ? 'production'
          : 'sandbox';
    return {
      airline: { name: env.AIRLINE_NAME, iataCode: env.AIRLINE_IATA_CODE },
      currency: env.DEFAULT_CURRENCY,
      timezone: env.DEFAULT_TIMEZONE,
      locales: env.SUPPORTED_LOCALES.split(',').map((l) => l.trim()) as MetaDto['locales'],
      features: {
        mpesa: { enabled: true, mode: mpesaMode },
        stripe: { enabled: true, mode: env.STRIPE_MODE === 'mock' ? 'mock' : 'live' },
        smsProvider: env.SMS_PROVIDER,
        emailProvider: env.EMAIL_PROVIDER,
        simulator: env.FLIGHT_SIMULATOR_ENABLED,
      },
      limits: {
        maxPaxPerBooking: env.MAX_PAX_PER_BOOKING,
        seatHoldTtlSeconds: env.SEAT_HOLD_TTL_SECONDS,
        checkinWindowOpenHours: env.CHECKIN_WINDOW_OPEN_HOURS,
        checkinWindowCloseHours: env.CHECKIN_WINDOW_CLOSE_HOURS,
      },
    };
  }
}

@Module({
  controllers: [MetaController],
})
export class MetaModule {}
