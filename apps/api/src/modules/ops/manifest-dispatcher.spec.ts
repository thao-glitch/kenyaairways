import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  HttpManifestDispatcher,
  NoopManifestDispatcher,
  type ManifestPayload,
} from './manifest-dispatcher';

/**
 * The KCAA hook contract, exercised against a fake endpoint: the no-op default
 * must never throw, the HTTP implementation must send exactly one well-formed
 * JSON document with bearer auth and must report non-2xx as failures (so the
 * BullMQ worker retries) while transport errors reject (same retry path).
 */

const payload: ManifestPayload = {
  flightId: 'fl_abcdef12345',
  flightNumber: 'F13101',
  originCode: 'NBO',
  destinationCode: 'MBA',
  departureUtc: '2026-10-10T04:00:00.000Z',
  gate: 'B2',
  operator: 'Flight13 Air',
  generatedAt: '2026-10-09T10:00:00.000Z',
  passengers: [
    {
      seq: 1,
      pnr: 'ZU986Z',
      ticketNumber: '0131234567890',
      firstName: 'Amani',
      lastName: 'Wanjala',
      seatLabel: '1A',
      boardingSequence: 1,
      checkInStatus: 'CHECKED_IN',
      checkedInAt: '2026-10-09T09:00:00.000Z',
      fareClass: 'SAVER',
      nationality: 'KE',
      docType: 'PASSPORT',
      baggageKg: 23,
    },
  ],
};

interface Capture {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
}

describe('NoopManifestDispatcher', () => {
  it('succeeds without sending anything (dev/CI default)', async () => {
    const result = await new NoopManifestDispatcher().dispatch(payload);
    expect(result).toMatchObject({ ok: true, responseCode: null });
    expect(result.message).toContain('no endpoint configured');
  });
});

describe('HttpManifestDispatcher (fake endpoint)', () => {
  let server: Server;
  let endpoint = '';
  let capture: Capture = { headers: {} };
  let respond: (res: ServerResponse) => void = (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"accepted":true}');
  };

  beforeAll(async () => {
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/kcaa/manifest`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  afterEach(() => {
    capture = { headers: {} };
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"accepted":true}');
    };
  });

  it('POSTs the manifest as JSON with bearer auth and reports acceptance', async () => {
    const dispatcher = new HttpManifestDispatcher(endpoint, 'secret-token');
    const result = await dispatcher.dispatch(payload);

    expect(result).toEqual({ ok: true, responseCode: 200, message: 'accepted' });
    expect(capture.method).toBe('POST');
    expect(capture.url).toBe('/kcaa/manifest');
    expect(capture.headers['content-type']).toBe('application/json');
    expect(capture.headers.authorization).toBe('Bearer secret-token');

    const body = JSON.parse(capture.body ?? '') as ManifestPayload;
    expect(body.flightNumber).toBe('F13101');
    expect(body.operator).toBe('Flight13 Air');
    expect(body.passengers).toHaveLength(1);
    expect(body.passengers[0]).toMatchObject({ pnr: 'ZU986Z', seatLabel: '1A' });
    // no stray secrets in the payload
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('omits the authorization header when no token is configured', async () => {
    const dispatcher = new HttpManifestDispatcher(endpoint);
    await dispatcher.dispatch(payload);
    expect(capture.headers.authorization).toBeUndefined();
  });

  it('returns ok=false with the status for a rejecting endpoint', async () => {
    respond = (res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('maintenance');
    };
    const dispatcher = new HttpManifestDispatcher(endpoint, 'secret-token');
    const result = await dispatcher.dispatch(payload);

    expect(result.ok).toBe(false);
    expect(result.responseCode).toBe(503);
    expect(result.message).toContain('503');
  });

  it('rejects (retryable) when the endpoint is unreachable', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const dispatcher = new HttpManifestDispatcher(endpoint);
    await expect(dispatcher.dispatch(payload)).rejects.toThrow();

    // reopen so afterAll can close cleanly
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/kcaa/manifest`;
  });
});
