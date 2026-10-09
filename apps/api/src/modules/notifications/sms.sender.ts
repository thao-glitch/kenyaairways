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

const AT_TIMEOUT_MS = 10_000;

/**
 * Africa's Talking — the primary Kenyan route. The base URL is constructor
 * injectable so tests can point it at a fake endpoint; production never
 * overrides it.
 */
@Injectable()
export class AfricasTalkingSmsSender extends SmsSender {
  constructor(private readonly baseUrl: string = 'https://api.africastalking.com') {
    super();
  }

  async send(to: string, body: string): Promise<SmsResult> {
    const env = getEnv();
    const params = new URLSearchParams({
      username: env.AFRICASTALKING_USERNAME,
      to: to.replace(/^\+/, ''), // the API takes 2547…, not +2547…
      message: body,
    });
    if (env.AFRICASTALKING_SENDER_ID) params.set('from', env.AFRICASTALKING_SENDER_ID);

    const res = await postForm(
      `${this.baseUrl}/version1/messaging`,
      params,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: env.AFRICASTALKING_API_KEY,
        accept: 'application/json',
      },
      "Africa's Talking",
    );

    const text = await res.text();
    if (!res.ok) {
      throw providerError("Africa's Talking", res.status);
    }
    const parsed = safeJson(text) as {
      SMSMessageData?: { Recipients?: Array<{ status?: string; messageId?: string }> };
    };
    const recipient = parsed?.SMSMessageData?.Recipients?.[0];
    if (!recipient) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        "Africa's Talking accepted but reported no recipients",
      );
    }
    if (!/^(success|queued)$/i.test(recipient.status ?? '')) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        `SMS rejected by Africa's Talking: ${recipient.status ?? 'unknown status'}`,
      );
    }
    return { providerRef: recipient.messageId ?? 'at-unknown' };
  }
}

/**
 * Twilio fallback. Same shape: form-encoded POST, Basic auth, base URL
 * injectable for tests, transport problems mapped onto the error envelope.
 */
@Injectable()
export class TwilioSmsSender extends SmsSender {
  constructor(private readonly baseUrl: string = 'https://api.twilio.com') {
    super();
  }

  async send(to: string, body: string): Promise<SmsResult> {
    const env = getEnv();
    const params = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body });
    const basic = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
      'base64',
    );

    const res = await postForm(
      `${this.baseUrl}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      params,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      'Twilio',
    );

    const text = await res.text();
    if (!res.ok) throw providerError('Twilio', res.status);
    const parsed = safeJson(text) as { sid?: string; status?: string };
    if (!parsed?.sid) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Twilio accepted but returned no message id');
    }
    return { providerRef: parsed.sid };
  }
}

export function createSmsSender(): SmsSender {
  switch (getEnv().SMS_PROVIDER) {
    case 'africastalking':
      return new AfricasTalkingSmsSender();
    case 'twilio':
      return new TwilioSmsSender();
    default:
      return new MockSmsSender();
  }
}

async function postForm(
  url: string,
  params: URLSearchParams,
  headers: Record<string, string>,
  provider: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: params,
      signal: AbortSignal.timeout(AT_TIMEOUT_MS),
    });
  } catch (err) {
    // DNS/timeout/reset — never surface transport detail, just the provider.
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('SERVICE_UNAVAILABLE', `${provider} send failed (transport)`, { message });
  }
}

function providerError(provider: string, status: number): AppError {
  return new AppError('SERVICE_UNAVAILABLE', `${provider} rejected the send (HTTP ${status})`);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 6) return '***';
  return `${msisdn.slice(0, 5)}***${msisdn.slice(-3)}`;
}
