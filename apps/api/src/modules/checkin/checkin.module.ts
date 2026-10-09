import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { SmsModule } from '../notifications/sms.module';
import { BoardingPassController, CheckInController } from './checkin.controller';
import { CheckInService } from './checkin.service';

/** Passenger check-in and boarding passes (M7). */
@Module({
  imports: [RealtimeModule, SmsModule],
  controllers: [CheckInController, BoardingPassController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
