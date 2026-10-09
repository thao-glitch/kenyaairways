import { Module } from '@nestjs/common';
import { SmsSender, createSmsSender } from './sms.sender';

/**
 * SMS delivery behind one token — auth (OTPs), ticketing and check-in all
 * inject `SmsSender`; the active provider (mock / Africa's Talking / Twilio)
 * is chosen by env at boot.
 */
@Module({
  providers: [{ provide: SmsSender, useFactory: createSmsSender }],
  exports: [SmsSender],
})
export class SmsModule {}
