import { Injectable } from '@nestjs/common';
import { AppError } from '@flight13/shared';
import { getEnv } from '../../config/env';
import { createLogger } from '../../common/logger';

export interface SmsResult {
  providerRef: string;
}

/** Abstract class (not an interface) so Nest can use it as an injection token. */
export abstract class SmsSender {
  /** Delivers `body` to an E.164 number. Never logs the full MSISDN. */
  abstract send(to: string, body: string): Promise<SmsResult>;
}

/**
 * Mock provider (SMS_PROVIDER=mock): no network calls — the message is logged
 * and returned with a deterministic-ish reference so dev/CI stay hermetic.
 * Live providers are selected by env; see LiveSmsSender.
 */
@Injectable()
export class MockSmsSender implements SmsSender {
  private readonly log = createLogger('sms');

  async send(to: string, body: string): Promise<SmsResult> {
    const providerRef = `mock-${Date.now().toString(36)}`;
    this.log.info('sms sent (mock)', { to: maskMsisdn(to), providerRef, chars: body.length });
    return { providerRef };
  }
}

/**
 * Placeholder for Africa's Talking / Twilio — chosen by env today (env
 * validation already demands credentials), but the HTTP integration lands in
 * M9. Failing loudly at send time beats silently dropping an OTP.
 */
@Injectable()
export class LiveSmsSender implements SmsSender {
  async send(to: string, body: string): Promise<SmsResult> {
    const provider = getEnv().SMS_PROVIDER;
    void body;
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `SMS provider "${provider}" is not wired yet (M9) — set SMS_PROVIDER=mock for local development`,
      { to: maskMsisdn(to) },
    );
  }
}

export function createSmsSender(): SmsSender {
  return getEnv().SMS_PROVIDER === 'mock' ? new MockSmsSender() : new LiveSmsSender();
}

function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 6) return '***';
  return `${msisdn.slice(0, 5)}***${msisdn.slice(-3)}`;
}
