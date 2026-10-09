import { Module } from '@nestjs/common';
import { getEnv } from '../../config/env';
import { RealtimeModule } from '../../realtime/realtime.module';
import { FlightsModule } from '../flights/flights.module';
import {
  HttpManifestDispatcher,
  MANIFEST_DISPATCHER,
  NoopManifestDispatcher,
} from './manifest-dispatcher';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Ops workspace + KCAA manifest hook. The dispatcher is chosen at boot:
 * HTTP when `KCAA_MANIFEST_URL` is configured, otherwise the no-op default
 * (nothing leaves the process in dev/CI).
 */
@Module({
  imports: [FlightsModule, RealtimeModule],
  controllers: [OpsController],
  providers: [
    OpsService,
    {
      provide: MANIFEST_DISPATCHER,
      useFactory: () => {
        const env = getEnv();
        return env.KCAA_MANIFEST_URL
          ? new HttpManifestDispatcher(env.KCAA_MANIFEST_URL, env.KCAA_MANIFEST_TOKEN || undefined)
          : new NoopManifestDispatcher();
      },
    },
  ],
  exports: [OpsService],
})
export class OpsModule {}
