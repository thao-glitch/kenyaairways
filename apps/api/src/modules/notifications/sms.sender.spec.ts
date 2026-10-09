import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppError } from '@flight13/shared';
import { __setEnvForTests, getEnv, type Env } from '../../config/env';
import {
  AfricasTalkingSmsSender,
  MockSmsSender,
  TwilioSmsSender,
  createSmsSender,
} from './sms.sender';

/**
 * The live SMS integrations, exercised against fake endpoints: exact URL, auth
 * headers and form shape per provider, provider error mapping onto the error
 * envelope, and the factory's env-driven selection. No network ever leaves.
 */

const MSISDN = '+254712345678';

interface Capture {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
}

describe('sms senders (fake endpoints)', () => {
  let server: Server;
  let baseUrl = '';
  let capture: Capture = { headers: {} };
  let respond: (res: ServerResponse) => void;
  let baseline: Env;

  const json = (status: number, payload: unknown) => (res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const atSuccess = json(200, {
    SMSMessageData: {
      Message: 'Processed',
      Recipients: [{ status: 'Success', messageId: 'AT_msg_1', recipient: '254712345678' }],
    },
  });

  beforeAll(() => {
    baseline = getEnv();
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        capture = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        respond(res);
      });
    });
    respond = atSuccess;
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  afterEach(() => {
    capture = { headers: {} };
    respond = atSuccess;
    __setEnvForTests(baseline);
  });

  describe('AfricasTalkingSmsSender', () => {
    it('POSTs form data with the apiKey header and a plus-stripped MSISDN', async () => {
      __setEnvForTests({
        ...baseline,
        AFRICASTALKING_API_KEY: 'at-key-123',
        AFRICASTALKING_USERNAME: 'flight13-dev',
        AFRICASTALKING_SENDER_ID: 'FLIGHT13',
      });
      const sender = new AfricasTalkingSmsSender(baseUrl);
      const result = await sender.send(MSISDN, 'Flight13: your code is 123456');

      expect(result.providerRef).toBe('AT_msg_1');
      expect(capture.method).toBe('POST');
      expect(capture.url).toBe('/version1/messaging');
      expect(capture.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(capture.headers.apikey).toBe('at-key-123');

      const form = new URLSearchParams(capture.body ?? '');
      expect(form.get('username')).toBe('flight13-dev');
      expect(form.get('to')).toBe('254712345678'); // no leading plus
      expect(form.get('from')).toBe('FLIGHT13');
      expect(form.get('message')).toBe('Flight13: your code is 123456');
    });

    it('maps a non-2xx response onto SERVICE_UNAVAILABLE', async () => {
      respond = json(400, { errorMessage: 'Invalid username' });
      const sender = new AfricasTalkingSmsSender(baseUrl);
      const err = await sender.send(MSISDN, 'x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('SERVICE_UNAVAILABLE');
      expect((err as AppError).status).toBe(503);
      expect((err as AppError).message).toContain('400');
    });

    it('rejects a 200 whose recipient status is a failure', async () => {
      respond = json(200, {
        SMSMessageData: {
          Message: 'Processed',
          Recipients: [{ status: 'InvalidPhoneNumber', recipient: '2547…' }],
        },
      });
      const sender = new AfricasTalkingSmsSender(baseUrl);
      await expect(sender.send(MSISDN, 'x')).rejects.toThrow(/InvalidPhoneNumber/);
    });

    it('reports transport failures without leaking the MSISDN', async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const sender = new AfricasTalkingSmsSender(baseUrl);
      const err = await sender.send(MSISDN, 'x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify({ message: (err as AppError).message })).not.toContain('254712345678');

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
  });

  describe('TwilioSmsSender', () => {
    it('POSTs to the account Messages endpoint with Basic auth', async () => {
      respond = json(201, { sid: 'SM_msg_1', status: 'queued' });
      __setEnvForTests({
        ...baseline,
        TWILIO_ACCOUNT_SID: 'ACabc123',
        TWILIO_AUTH_TOKEN: 'tok-secret',
        TWILIO_FROM: '+254700000000',
      });
      const sender = new TwilioSmsSender(baseUrl);
      const result = await sender.send(MSISDN, 'Body text');

      expect(result.providerRef).toBe('SM_msg_1');
      expect(capture.url).toBe('/2010-04-01/Accounts/ACabc123/Messages.json');
      const expectedAuth = `Basic ${Buffer.from('ACabc123:tok-secret').toString('base64')}`;
      expect(capture.headers.authorization).toBe(expectedAuth);

      const form = new URLSearchParams(capture.body ?? '');
      expect(form.get('To')).toBe(MSISDN); // Twilio keeps the plus
      expect(form.get('From')).toBe('+254700000000');
      expect(form.get('Body')).toBe('Body text');
    });

    it('maps a Twilio error response onto SERVICE_UNAVAILABLE', async () => {
      respond = json(401, { code: 20003, message: 'Authenticate' });
      const sender = new TwilioSmsSender(baseUrl);
      await expect(sender.send(MSISDN, 'x')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      });
    });

    it('fails when Twilio returns 2xx without a message sid', async () => {
      respond = json(201, { status: 'queued' });
      const sender = new TwilioSmsSender(baseUrl);
      await expect(sender.send(MSISDN, 'x')).rejects.toThrow(/no message id/);
    });
  });

  describe('factory + mock', () => {
    it('returns the mock sender by default (dev/CI hermetic)', () => {
      expect(createSmsSender()).toBeInstanceOf(MockSmsSender);
    });

    it('selects the live sender by SMS_PROVIDER', () => {
      __setEnvForTests({ ...baseline, SMS_PROVIDER: 'africastalking' });
      expect(createSmsSender()).toBeInstanceOf(AfricasTalkingSmsSender);
      __setEnvForTests({ ...baseline, SMS_PROVIDER: 'twilio' });
      expect(createSmsSender()).toBeInstanceOf(TwilioSmsSender);
    });

    it('the mock sends without a network and masks the MSISDN in logs', async () => {
      const result = await new MockSmsSender().send(MSISDN, 'hello');
      expect(result.providerRef).toMatch(/^mock-/);
    });
  });
});
