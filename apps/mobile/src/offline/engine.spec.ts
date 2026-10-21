/**
 * Offline engine suite — runs the real engine against an in-memory SQLite DB
 * via node:sqlite, exercising the same request → response contract the mobile
 * app sends to the NestJS API.
 *
 * What this proves:
 *  - auth (local register/login/refresh, remote-token identity)
 *  - flight search (incl. ensureRoute materialisation) + seats + status
 *  - booking creation auto-confirms + issues tickets + records a CASH payment
 *  - check-in (with offline leniency) + boarding pass + baggage
 *  - admin: flights list/prices, bookings q, verifier, reports, site settings
 *  - error envelopes match the server (code + HTTP status via httpStatusFor)
 */
import bcrypt from 'bcryptjs';
import { httpStatusFor } from '@kenyaairways/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openNodeDb } from './node-db';
import { World } from './world';
import { handle } from './engine';
import type { EngineCtx } from './engine-support';
import type { LocalRequest, LocalResponse } from './types';

// bcryptjs is pure JS (sync variants are fine in node).

const NOW = Date.parse('2026-10-21T09:00:00.000Z');

function makeCtx(): EngineCtx {
  const db = openNodeDb(':memory:');
  const world = World.load(db, { windowDaysAhead: 7 });
  return { db, world, now: () => NOW };
}

function call(
  ctx: EngineCtx,
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; token?: string } = {},
): LocalResponse {
  const req: LocalRequest = {
    method,
    path,
    query: opts.query ?? {},
    body: opts.body,
    authorization: opts.token ? `Bearer ${opts.token}` : null,
  };
  return handle(ctx, req);
}

function ok<T>(res: LocalResponse): T {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as T;
}

function expectError(res: LocalResponse, code: string, status?: number): void {
  const body = res.body as { error?: { code?: string } };
  expect(body.error?.code).toBe(code);
  expect(res.status).toBe(status ?? httpStatusFor(code));
}

// ── auth ────────────────────────────────────────────────────────────────────

describe('engine auth', () => {
  let ctx: EngineCtx;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('logs in the seeded admin and honours STAFF_ROLES', () => {
    const res = ok<{ user: { email: string; role: string }; session: { accessToken: string } }>(
      call(ctx, 'POST', '/api/v1/auth/login', {
        body: { identifier: 'admin@kenyaairways.example', password: 'Password123!' },
      }),
    );
    expect(res.user.email).toBe('admin@kenyaairways.example');
    expect(res.user.role).toBe('ADMIN');
    expect(res.session.accessToken).toMatch(/^loc\./);
  });

  it('rejects a wrong password with UNAUTHENTICATED (401)', () => {
    const res = call(ctx, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'admin@kenyaairways.example', password: 'nope' },
    });
    expectError(res, 'UNAUTHENTICATED', 401);
  });

  it('registers a new passenger and /auth/me works with the token', () => {
    const reg = ok<{ session: { accessToken: string } }>(
      call(ctx, 'POST', '/api/v1/auth/register', {
        body: {
          email: 'new@example.com',
          password: 'password123',
          firstName: 'New',
          lastName: 'Traveller',
          acceptTerms: true,
        },
      }),
    );
    const me = ok<{ email: string; role: string }>(
      call(ctx, 'GET', '/api/v1/auth/me', { token: reg.session.accessToken }),
    );
    expect(me.email).toBe('new@example.com');
    expect(me.role).toBe('PASSENGER');
  });

  it('accepts a remote bearer token stored in local_session', () => {
    // Simulate api.ts remembering a remote login.
    const db = ctx.db;
    const row = db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [
      'passenger@kenyaairways.example',
    ]);
    db.run(
      `INSERT INTO local_session (id, user_id, user_json, access_token, refresh_token, expires_at)
       VALUES (1, ?, ?, 'eyJhbGciOi.remote', 'refresh-remote', ?)`,
      [
        row!.id,
        JSON.stringify({ id: row!.id, email: 'passenger@kenyaairways.example', role: 'PASSENGER' }),
        Math.floor(NOW / 1000) + 3600,
      ],
    );
    const me = ok<{ email: string }>(
      call(ctx, 'GET', '/api/v1/auth/me', { token: 'eyJhbGciOi.remote' }),
    );
    expect(me.email).toBe('passenger@kenyaairways.example');
  });

  it('refreshes a local refresh token into a new local access token', () => {
    const login = ok<{ session: { refreshToken: string } }>(
      call(ctx, 'POST', '/api/v1/auth/login', {
        body: { identifier: 'agent@kenyaairways.example', password: 'Password123!' },
      }),
    );
    const refreshed = ok<{ rotated: boolean; session: { accessToken: string } }>(
      call(ctx, 'POST', '/api/v1/auth/refresh', {
        body: { refreshToken: login.session.refreshToken },
      }),
    );
    expect(refreshed.rotated).toBe(true);
    expect(refreshed.session.accessToken).toMatch(/^loc\./);
  });

  it('verifies the exported bcrypt hashes (cost 10)', () => {
    const row = ctx.db.get<{ passwordHash: string }>(
      'SELECT passwordHash FROM users WHERE email = ?',
      ['admin@kenyaairways.example'],
    );
    expect(bcrypt.compareSync('Password123!', row!.passwordHash)).toBe(true);
  });
});

// ── flights ─────────────────────────────────────────────────────────────────

interface SearchResult {
  results: Array<{
    flightId: string;
    flightNumber: string;
    fareOptions: Array<{
      fareClass: { code: string; cabin: string };
      pricing: { totalMinor: number };
    }>;
  }>;
}

describe('engine flights', () => {
  let ctx: EngineCtx;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('searches a seeded route and prices with taxes', () => {
    const res = ok<SearchResult>(
      call(ctx, 'GET', '/api/v1/flights/search', {
        query: { origin: 'NBO', destination: 'MBA', date: '2026-10-22' },
      }),
    );
    expect(res.results.length).toBeGreaterThan(0);
    const first = res.results[0];
    expect(first.flightNumber).toMatch(/^(F9|F13)/);
    expect(first.fareOptions.length).toBeGreaterThan(0);
    const economy = first.fareOptions.find((f) => f.fareClass.cabin === 'ECONOMY');
    expect(economy).toBeDefined();
    expect(economy!.pricing.totalMinor).toBeGreaterThan(0);
  });

  it('rejects same origin and destination with BAD_REQUEST (400)', () => {
    const res = call(ctx, 'GET', '/api/v1/flights/search', {
      query: { origin: 'NBO', destination: 'NBO', date: '2026-10-22' },
    });
    expectError(res, 'BAD_REQUEST', 400);
  });

  it('rejects a past date with BAD_REQUEST (400)', () => {
    const res = call(ctx, 'GET', '/api/v1/flights/search', {
      query: { origin: 'NBO', destination: 'MBA', date: '2020-01-01' },
    });
    expectError(res, 'BAD_REQUEST', 400);
  });

  it('materialises a route that has no schedule (fly anywhere)', () => {
    const res = ok<SearchResult>(
      call(ctx, 'GET', '/api/v1/flights/search', {
        query: { origin: 'NBO', destination: 'KIS', date: '2026-10-23' },
      }),
    );
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('serves flight detail, status, position and seats', () => {
    const search = ok<SearchResult>(
      call(ctx, 'GET', '/api/v1/flights/search', {
        query: { origin: 'NBO', destination: 'MBA', date: '2026-10-22' },
      }),
    );
    const flightId = search.results[0].flightId;

    const detail = ok<{ flightId: string }>(call(ctx, 'GET', `/api/v1/flights/${flightId}`));
    expect(detail.flightId).toBe(flightId);

    const status = ok<{ status: string }>(call(ctx, 'GET', `/api/v1/flights/${flightId}/status`));
    expect(['SCHEDULED', 'BOARDING', 'DEPARTED', 'IN_AIR', 'LANDED']).toContain(status.status);

    const position = ok<{ phase: string; progress: number }>(
      call(ctx, 'GET', `/api/v1/flights/${flightId}/position`),
    );
    expect(position.progress).toBeGreaterThanOrEqual(0);
    expect(['SCHEDULED', 'ENROUTE', 'LANDED']).toContain(position.phase);

    const seats = ok<{ seats: Array<{ status: string }> }>(
      call(ctx, 'GET', `/api/v1/flights/${flightId}/seats`),
    );
    expect(seats.seats.length).toBeGreaterThan(0);
    expect(seats.seats.some((s) => s.status === 'AVAILABLE')).toBe(true);
  });

  it('serves airports and meta without auth', () => {
    const airports = ok<Array<{ code: string }>>(call(ctx, 'GET', '/api/v1/airports'));
    expect(airports.length).toBeGreaterThan(50);
    const meta = ok<{ airline: { iataCode: string } }>(call(ctx, 'GET', '/api/v1/meta'));
    expect(meta.airline.iataCode).toBe('F13');
  });

  it('serves site-settings with the Payment number paybill', () => {
    const site = ok<{ appName: string; mpesaPaybill: string | null }>(
      call(ctx, 'GET', '/api/v1/site-settings'),
    );
    expect(site.appName).toBe('Kenya Airways');
    expect(site.mpesaPaybill).toBe('0182774255');
  });
});

// ── bookings ────────────────────────────────────────────────────────────────

interface BookingDtoLike {
  id: string;
  pnr: string;
  status: string;
  totalMinor: number;
  passengers: Array<{ firstName: string; lastName: string }>;
  seatHolds: Array<{ seatLabel: string; status: string }>;
}

function loginAs(ctx: EngineCtx, identifier: string): string {
  const res = ok<{ session: { accessToken: string } }>(
    call(ctx, 'POST', '/api/v1/auth/login', { body: { identifier, password: 'Password123!' } }),
  );
  return res.session.accessToken;
}

function searchOne(ctx: EngineCtx, token: string) {
  const search = ok<SearchResult>(
    call(ctx, 'GET', '/api/v1/flights/search', {
      query: { origin: 'NBO', destination: 'MBA', date: '2026-10-22' },
      token,
    }),
  );
  const option = search.results[0];
  return { flightId: option.flightId, fare: option.fareOptions[0].fareClass.code };
}

function book(ctx: EngineCtx, token: string, flightId: string, fare: string): BookingDtoLike {
  return ok<BookingDtoLike>(
    call(ctx, 'POST', '/api/v1/bookings', {
      token,
      body: {
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: fare }],
        passengers: [
          { type: 'ADULT', firstName: 'Amina', lastName: 'Hassan' },
          { type: 'CHILD', firstName: 'Ali', lastName: 'Hassan' },
        ],
        contactEmail: 'amina@example.com',
      },
    }),
  );
}

describe('engine bookings', () => {
  let ctx: EngineCtx;
  let token: string;
  beforeEach(() => {
    ctx = makeCtx();
    token = loginAs(ctx, 'passenger@kenyaairways.example');
  });

  it('auto-confirms with tickets issued and a PAID CASH payment', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.pnr).toMatch(/^[A-Z0-9]{6}$/);

    const tickets = ctx.db.all<{ ticketNumber: string; status: string; seatLabel: string | null }>(
      'SELECT * FROM tickets WHERE bookingId = ?',
      [booking.id],
    );
    expect(tickets).toHaveLength(2);
    expect(tickets[0].status).toBe('ISSUED');
    expect(tickets[0].ticketNumber).toMatch(/^013\d{10}$/);

    const payment = ctx.db.get<{ status: string; provider: string; providerRef: string | null }>(
      'SELECT status, provider, providerRef FROM payments WHERE bookingId = ?',
      [booking.id],
    );
    expect(payment?.status).toBe('PAID');
    expect(payment?.provider).toBe('CASH');
    expect(payment?.providerRef).toBe(`CASH-${booking.pnr}`);
  });

  it('decrements inventory exactly once per seat', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const before = ctx.db.get<{ seatsSold: number }>(
      'SELECT seatsSold FROM inventory WHERE flightId = ? AND fareClassCode = ?',
      [flightId, fare],
    );
    book(ctx, token, flightId, fare);
    const after = ctx.db.get<{ seatsSold: number }>(
      'SELECT seatsSold FROM inventory WHERE flightId = ? AND fareClassCode = ?',
      [flightId, fare],
    );
    expect(after!.seatsSold).toBe(before!.seatsSold + 2);
  });

  it('lists bookings as a Paginated envelope', () => {
    const { flightId, fare } = searchOne(ctx, token);
    book(ctx, token, flightId, fare);
    const page = ok<{ items: BookingDtoLike[]; total: number; hasMore: boolean }>(
      call(ctx, 'GET', '/api/v1/bookings', { token }),
    );
    expect(page.items.length).toBe(1);
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('holds a seat on a confirmed booking (label form)', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const held = ok<BookingDtoLike>(
      call(ctx, 'POST', `/api/v1/bookings/${booking.id}/seats`, {
        token,
        body: { seatLabel: '1A' },
      }),
    );
    expect(held.seatHolds.some((h) => h.seatLabel === '1A' && h.status === 'ACTIVE')).toBe(true);

    // The same seat cannot be held again (unique activeKey).
    const again = call(ctx, 'POST', `/api/v1/bookings/${booking.id}/seats`, {
      token,
      body: { seatLabel: '1A' },
    });
    expectError(again, 'SEAT_UNAVAILABLE', 409);
  });

  it('checks in (offline leniency skips TOO_EARLY) and issues a boarding pass', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const result = ok<{
      checkIns: Array<{ boardingPassId: string | null; seatLabel: string | null }>;
      bookingStatus: string;
    }>(call(ctx, 'POST', '/api/v1/check-in', { token, body: { bookingId: booking.id } }));
    expect(result.checkIns).toHaveLength(2);
    expect(result.bookingStatus).toBe('CHECKED_IN');
    expect(result.checkIns[0].seatLabel).toBeTruthy();
    expect(result.checkIns[0].boardingPassId).toBeTruthy();

    const passId = result.checkIns[0].boardingPassId!;
    const pass = ok<{ bcbp: string; seatLabel: string; passengerName: string }>(
      call(ctx, 'GET', `/api/v1/boarding-passes/${passId}`, { token }),
    );
    expect(pass.bcbp).toContain('NBO');
    expect(pass.passengerName).toContain('Hassan');
  });

  it('tracks baggage stages from the flight status', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const bag = ok<{ items: Array<{ current: string }> }>(
      call(ctx, 'GET', `/api/v1/check-in/bookings/${booking.id}/baggage`, { token }),
    );
    expect(bag.items).toHaveLength(2);
    expect(['ACCEPTED', 'LOADED', 'IN_TRANSIT', 'ON_BELT']).toContain(bag.items[0].current);
  });

  it('cancels a confirmed booking and releases inventory', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const before = ctx.db.get<{ seatsSold: number }>(
      'SELECT seatsSold FROM inventory WHERE flightId = ? AND fareClassCode = ?',
      [flightId, fare],
    );
    const cancelled = ok<BookingDtoLike>(
      call(ctx, 'POST', `/api/v1/bookings/${booking.id}/cancel`, {
        token,
        body: { reason: 'REBOOKED' },
      }),
    );
    expect(cancelled.status).toBe('CANCELLED');
    const after = ctx.db.get<{ seatsSold: number }>(
      'SELECT seatsSold FROM inventory WHERE flightId = ? AND fareClassCode = ?',
      [flightId, fare],
    );
    expect(after!.seatsSold).toBe(before!.seatsSold - 2);
  });

  it('is idempotent on ticket issue', () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const res = ok<{ tickets: unknown[]; alreadyIssued: boolean }>(
      call(ctx, 'POST', '/api/v1/ticketing/issue', { token, body: { bookingId: booking.id } }),
    );
    expect(res.alreadyIssued).toBe(true);
    expect(res.tickets).toHaveLength(2);
  });

  it("refuses another user's booking with FORBIDDEN (403)", () => {
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const other = loginAs(ctx, 'j.kamau@kenyaairways.example');
    const res = call(ctx, 'GET', `/api/v1/bookings/${booking.id}`, { token: other });
    expectError(res, 'FORBIDDEN', 403);
  });
});

// ── admin ───────────────────────────────────────────────────────────────────

describe('engine admin', () => {
  let ctx: EngineCtx;
  let adminToken: string;
  beforeEach(() => {
    ctx = makeCtx();
    adminToken = loginAs(ctx, 'admin@kenyaairways.example');
  });

  it('lists flights with fares for the price manager', () => {
    const rows = ok<Array<{ flightId: string; fares: Array<{ fareClassCode: string }> }>>(
      call(ctx, 'GET', '/api/v1/admin/flights', { token: adminToken }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].fares.length).toBeGreaterThan(0);
  });

  it('edits a fare and the search reflects it immediately', () => {
    const { flightId, fare } = searchOne(ctx, adminToken);
    const result = ok<{ faresUpdated: number }>(
      call(ctx, 'PATCH', `/api/v1/admin/flights/${flightId}/fares`, {
        token: adminToken,
        body: { fares: [{ fareClassCode: fare, baseFareMinor: 50_000_00 }] },
      }),
    );
    expect(result.faresUpdated).toBe(1);
    const row = ctx.db.get<{ baseFareMinor: number }>(
      'SELECT baseFareMinor FROM fares WHERE flightId = ? AND fareClassCode = ?',
      [flightId, fare],
    );
    expect(row?.baseFareMinor).toBe(5_000_000);
  });

  it('bulk price update respects the KES 10 floor', () => {
    const result = ok<{ faresUpdated: number }>(
      call(ctx, 'POST', '/api/v1/admin/flights/bulk-prices', {
        token: adminToken,
        body: {
          originCode: 'NBO',
          destinationCode: 'MBA',
          dateFrom: '2026-10-22',
          dateTo: '2026-10-22',
          operation: 'ADJUST_PERCENT',
          value: -90,
        },
      }),
    );
    expect(result.faresUpdated).toBeGreaterThan(0);
    const min = ctx.db.get<{ m: number }>(
      `SELECT MIN(baseFareMinor) AS m FROM fares f
        JOIN flights fl ON fl.id = f.flightId
        WHERE fl.originCode = 'NBO' AND fl.destinationCode = 'MBA' AND fl.flightDate = '2026-10-22'`,
    );
    expect(min!.m).toBeGreaterThanOrEqual(1_000);
  });

  it('finds bookings by PNR and passenger name', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const byPnr = ok<Array<{ pnr: string }>>(
      call(ctx, 'GET', '/api/v1/admin/bookings', { token: adminToken, query: { q: booking.pnr } }),
    );
    expect(byPnr).toHaveLength(1);
    const byName = ok<Array<{ pnr: string }>>(
      call(ctx, 'GET', '/api/v1/admin/bookings', {
        token: adminToken,
        query: { q: 'hassan amina' },
      }),
    );
    expect(byName.map((b) => b.pnr)).toContain(booking.pnr);
  });

  it('recordDirect on an already-paid offline booking conflicts (server parity)', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const res = call(ctx, 'POST', `/api/v1/admin/bookings/${booking.id}/pay`, {
      token: adminToken,
      body: { provider: 'CASH', amountMinor: booking.totalMinor, reference: 'COUNTER' },
    });
    expectError(res, 'CONFLICT', 409);
  });

  it('parses a pasted M-Pesa SMS (verifier dry-run)', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const message = `SJH4LMOP32 confirmed. Ksh${(booking.totalMinor / 100).toLocaleString(
      'en-US',
    )} sent to ACCOUNT 0182774255 for account ${booking.pnr} on 21/10/26 at 3:45 PM.`;
    const check = ok<{
      parsed: { receiptNumber: string | null; amountMinor: number | null };
      issues: string[];
    }>(
      call(ctx, 'POST', '/api/v1/admin/mpesa-verifier/parse', {
        token: adminToken,
        body: { message },
      }),
    );
    expect(check.parsed.receiptNumber).toBe('SJH4LMOP32');
    expect(check.parsed.amountMinor).toBe(booking.totalMinor);
  });

  it("verify against an offline booking's PAID payment conflicts (server parity)", () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const message = `SJH4LMOP32 confirmed. Ksh${(booking.totalMinor / 100).toFixed(2)} sent to ACCOUNT 0182774255 for account ${booking.pnr} on 21/10/26 at 3:45 PM.`;
    const res = call(ctx, 'POST', '/api/v1/admin/mpesa-verifier/verify', {
      token: adminToken,
      body: { message, pnr: booking.pnr },
    });
    // The record is created, then applying it hits the already-PAID payment —
    // exactly what the server does.
    expectError(res, 'CONFLICT', 409);
  });

  it('verify → confirm works when the booking awaits payment', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    // Offline bookings auto-confirm, so put this one back into the state a
    // payment would confirm (PENDING_PAYMENT) to exercise the success path.
    ctx.db.run(`UPDATE bookings SET status = 'PENDING_PAYMENT', confirmedAt = NULL WHERE id = ?`, [
      booking.id,
    ]);
    // Simulate a passenger-submitted pending payment (not the CASH one).
    ctx.db.run(
      `INSERT INTO payments (id, bookingId, provider, status, amountMinor, currency,
                             idempotencyKey, manual, createdAt)
       VALUES ('pay_pending', ?, 'MPESA_STK', 'PENDING', ?, 'KES', 'k1', 0, ?)`,
      [booking.id, booking.totalMinor, new Date(NOW).toISOString()],
    );
    ctx.db.run(
      `INSERT INTO mpesa_records (id, receiptNumber, amountMinor, currency, status,
                                  messageRaw, paymentId, bookingId, createdAt)
       VALUES ('mvr_1', 'ABCDEFGH12', ?, 'KES', 'PENDING', 'pasted sms', 'pay_pending', ?, ?)`,
      [booking.totalMinor, booking.id, new Date(NOW).toISOString()],
    );
    const confirmed = ok<{ record: { status: string }; payment: { status: string } }>(
      call(ctx, 'POST', '/api/v1/admin/mpesa-verifier/records/mvr_1/confirm', {
        token: adminToken,
        body: { notes: 'checked' },
      }),
    );
    expect(confirmed.record.status).toBe('CONFIRMED');
    expect(confirmed.payment.status).toBe('PAID');
    const fresh = ctx.db.get<{ status: string }>('SELECT status FROM bookings WHERE id = ?', [
      booking.id,
    ]);
    expect(fresh?.status).toBe('CONFIRMED');
  });

  it('confirm on an already-confirmed booking reports manual resolution (server parity)', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare); // auto-CONFIRMED offline
    ctx.db.run(
      `INSERT INTO payments (id, bookingId, provider, status, amountMinor, currency,
                             idempotencyKey, manual, createdAt)
       VALUES ('pay_pending2', ?, 'MPESA_STK', 'PENDING', ?, 'KES', 'k2', 0, ?)`,
      [booking.id, booking.totalMinor, new Date(NOW).toISOString()],
    );
    ctx.db.run(
      `INSERT INTO mpesa_records (id, receiptNumber, amountMinor, currency, status,
                                  messageRaw, paymentId, bookingId, createdAt)
       VALUES ('mvr_3', 'DEF123GH45', ?, 'KES', 'PENDING', 'pasted sms', 'pay_pending2', ?, ?)`,
      [booking.totalMinor, booking.id, new Date(NOW).toISOString()],
    );
    // Server parity: funds claimed, but the booking cannot transition
    // (CONFIRMED → CONFIRMED is invalid) → manual resolution.
    const res = call(ctx, 'POST', '/api/v1/admin/mpesa-verifier/records/mvr_3/confirm', {
      token: adminToken,
      body: {},
    });
    expectError(res, 'INVALID_STATE_TRANSITION', 409);
    const payment = ctx.db.get<{ status: string; failureMessage: string | null }>(
      'SELECT status, failureMessage FROM payments WHERE id = ?',
      ['pay_pending2'],
    );
    expect(payment?.status).toBe('PAID');
    expect(payment?.failureMessage).toContain('manual resolution');
  });

  it('rejects a verification record with a reason', () => {
    ctx.db.run(
      `INSERT INTO mpesa_records (id, receiptNumber, amountMinor, currency, status, messageRaw, createdAt)
       VALUES ('mvr_2', 'XXXXXXXX12', 100_00, 'KES', 'PENDING', 'pasted sms', ?)`,
      [new Date(NOW).toISOString()],
    );
    const res = ok<{ status: string; rejectReason: string | null }>(
      call(ctx, 'POST', '/api/v1/admin/mpesa-verifier/records/mvr_2/reject', {
        token: adminToken,
        body: { reason: 'Unreadable receipt' },
      }),
    );
    expect(res.status).toBe('REJECTED');
    expect(res.rejectReason).toBe('Unreadable receipt');
  });

  it('lists verification records paginated (25/page)', () => {
    const page = ok<{ items: unknown[]; pageSize: number }>(
      call(ctx, 'GET', '/api/v1/admin/mpesa-verifier/records', { token: adminToken }),
    );
    expect(page.pageSize).toBe(25);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('reports revenue for the last 30 Nairobi days', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const booking = book(ctx, token, flightId, fare);
    const report = ok<{
      currency: string;
      days: Array<{ day: string; grossMinor: number }>;
      totals: { grossMinor: number };
    }>(call(ctx, 'GET', '/api/v1/reports/revenue', { token: adminToken }));
    expect(report.currency).toBe('KES');
    const today = report.days[report.days.length - 1];
    expect(today.grossMinor).toBe(booking.totalMinor);
    expect(report.totals.grossMinor).toBeGreaterThanOrEqual(booking.totalMinor);
  });

  it('reports load factors for the next 7 days', () => {
    const report = ok<{
      rows: Array<{ flightId: string; capacity: number }>;
      totals: { flights: number };
    }>(call(ctx, 'GET', '/api/v1/reports/load', { token: adminToken }));
    expect(report.totals.flights).toBeGreaterThan(0);
    expect(report.rows[0].capacity).toBeGreaterThan(0);
  });

  it('updates site settings (appName + theme) and re-serves them', () => {
    const updated = ok<{ appName: string; theme: string }>(
      call(ctx, 'PATCH', '/api/v1/admin/site-settings', {
        token: adminToken,
        body: { appName: 'KQ Demo', theme: 'savanna' },
      }),
    );
    expect(updated.appName).toBe('KQ Demo');
    expect(updated.theme).toBe('savanna');
    const pub = ok<{ appName: string }>(call(ctx, 'GET', '/api/v1/site-settings'));
    expect(pub.appName).toBe('KQ Demo');
  });

  it('rejects an unknown theme with VALIDATION_ERROR (422)', () => {
    const res = call(ctx, 'PATCH', '/api/v1/admin/site-settings', {
      token: adminToken,
      body: { theme: 'neon' },
    });
    expectError(res, 'VALIDATION_ERROR', 422);
  });

  it('forbids non-staff from admin routes (403)', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const res = call(ctx, 'GET', '/api/v1/admin/flights', { token });
    expectError(res, 'FORBIDDEN', 403);
  });

  it('requires auth for admin routes (401)', () => {
    const res = call(ctx, 'GET', '/api/v1/admin/flights');
    expectError(res, 'UNAUTHENTICATED', 401);
  });
});

// ── error envelope + parity plumbing ────────────────────────────────────────

describe('engine envelope', () => {
  let ctx: EngineCtx;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('returns NOT_FOUND (404) for unknown routes', () => {
    const res = call(ctx, 'GET', '/api/v1/nope');
    expectError(res, 'NOT_FOUND', 404);
  });

  it('answers /healthz without auth', () => {
    const res = ok<{ status: string }>(call(ctx, 'GET', '/healthz'));
    expect(res.status).toBe('ok');
  });

  it('returns SEAT_UNAVAILABLE (409) when inventory runs out', () => {
    const token = loginAs(ctx, 'passenger@kenyaairways.example');
    const { flightId, fare } = searchOne(ctx, token);
    const stock = ctx.db.get<{ free: number }>(
      `SELECT (seatsTotal - seatsHeld - seatsSold - seatsBlocked) AS free
         FROM inventory WHERE flightId = ? AND fareClassCode = ?`,
      [flightId, fare],
    );
    const seatPax = stock!.free;
    const res = call(ctx, 'POST', '/api/v1/bookings', {
      token,
      body: {
        segments: [{ flightId, fareClassCode: fare }],
        passengers: Array.from({ length: seatPax + 1 }, (_, i) => ({
          type: i === 0 ? 'ADULT' : 'ADULT',
          firstName: 'P',
          lastName: `S${i}`,
        })),
      },
    });
    expectError(res, 'SEAT_UNAVAILABLE', 409);
  });
});
