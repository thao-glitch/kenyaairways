import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { RtEventsService } from './rt-events.service';
import { RtGateway } from './rt.gateway';

/**
 * Real-time transport for the whole API: `RtEventsService` is what domain
 * services publish to; `RtGateway` (Socket.IO `/rt`) is the single live sink.
 * Both live here so feature modules depend on events, never on sockets.
 */
@Module({
  imports: [AuthModule],
  providers: [RtEventsService, RtGateway],
  exports: [RtEventsService],
})
export class RealtimeModule {}
