import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { SmsModule } from '../notifications/sms.module';
import { PnrController, TicketingController } from './ticketing.controller';
import { TicketingService } from './ticketing.service';

/** Issuing e-tickets and PNR retrieval (M6). */
@Module({
  imports: [BookingsModule, RealtimeModule, SmsModule],
  controllers: [TicketingController, PnrController],
  providers: [TicketingService],
  exports: [TicketingService],
})
export class TicketingModule {}
