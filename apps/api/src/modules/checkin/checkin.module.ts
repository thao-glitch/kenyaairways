import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { SmsModule } from '../notifications/sms.module';
import { BaggageService } from './baggage.service';
import { BoardingPassController, CheckInController } from './checkin.controller';
import { CheckInService } from './checkin.service';

/** Passenger check-in, boarding passes and baggage tracking (M7 + mobile). */
@Module({
  imports: [RealtimeModule, SmsModule],
  controllers: [CheckInController, BoardingPassController],
  providers: [CheckInService, BaggageService],
  exports: [CheckInService, BaggageService],
})
export class CheckInModule {}
