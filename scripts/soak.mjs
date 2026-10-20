#!/usr/bin/env node
/**
 * Kenya Airways soak / load test (M10) — dependency-free Node ≥20.
 *
 * Drives the full passenger journey concurrently against a running stack:
 *
 *   search → book → M-Pesa STK (mock simulate) → confirm → issue tickets
 *
 * One account per virtual user is registered up front (outside the measured
 * window), then each user loops journeys until the deadline. Exit codes:
 *
 *   0  all thresholds met
 *   1  a threshold was breached (error rate / latency budget)
 *   2  could not run at all (stack down, setup failed)
 *
 * Config (env):
 *   SOAK_API_URL         base URL of the API      (default http://localhost:4000)
 *   SOAK_USERS           virtual users            (default 5)
 *   SOAK_DURATION_S      measured window, seconds (default 30)
 *   SOAK_MAX_ERROR_PCT   max failed journeys, %   (default 1)
 *   SOAK_MAX_P95_MS      overall request p95, ms  (default 2000)
 */
import { randomInt } from 'node:crypto';

const API = (process.env.SOAK_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const USERS = Number(process.env.SOAK_USERS ?? 5);
const DURATION_S = Number(process.env.SOAK_DURATION_S ?? 30);
const MAX_ERROR_PCT = Number(process.env.SOAK_MAX_ERROR_PCT ?? 1);
const MAX_P95_MS = Number(process.env.SOAK_MAX_P95_MS ?? 2000);
const REQUEST_TIMEOUT_MS = 15_000;

/** Rotated so concurrent users spread across flights (no seat exhaustion). */
const ROUTES = [
  ['NBO', 'MBA'],
  ['NBO', 'KIS'],
  ['NBO', 'EDL'],
  ['NBO', 'MYD'],
  ['NBO', 'LAU'],
  ['NBO', 'EBB'],
  ['NBO', 'DAR'],
  ['MBA', 'NBO'],
  ['KIS', 'NBO'],
];
const DAY_OFFSETS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Per-operation latency samples (ms) + failure counts. */
const ops = new Map();
function record(op, ms, error) {
  let bucket = ops.get(op);
  if (!bucket) {
    bucket = { samples: [], errors: 0 };
    ops.set(op, bucket);
  }
  if (ms !== null) bucket.samples.push(ms);
  if (error) bucket.errors += 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[randomInt(list.length)];

function cookieHeader(setCookies) {
  if (!setCookies || setCookies.length === 0) return null;
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

/**
 * fetch with cookie jar + one transparent refresh retry on 401.
 * Returns { status, body, cookie } — throws only on network/timeout.
 */
async function call(user, path, { method = 'GET', body, expect } = {}) {
  const doFetch = async () => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(user?.cookie ? { cookie: user.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const fresh = cookieHeader(res.headers.getSetCookie());
    if (fresh) user.cookie = fresh;
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      /* non-JSON body (e.g. 404 HTML from a proxy) — status carries the result */
    }
    return { status: res.status, body: parsed };
  };

  let out = await doFetch();
  if (out.status === 401 && user?.cookie) {
    const refreshed = await fetch(`${API}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: user.cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const fresh = cookieHeader(refreshed.headers.getSetCookie());
    if (fresh) {
      user.cookie = fresh;
      out = await doFetch();
    }
  }
  if (expect && out.status !== expect) {
    const message = out.body?.error?.message ?? `HTTP ${out.status}`;
    throw new Error(`${method} ${path} → ${out.status}: ${message}`);
  }
  return out;
}

async function timed(op, fn) {
  const start = performance.now();
  try {
    const out = await fn();
    record(op, performance.now() - start, false);
    return out;
  } catch (err) {
    record(op, performance.now() - start, true);
    throw err;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const fmt = (ms) => `${Math.round(ms)}ms`;

/** One full passenger journey. Throws on the first failed step. */
async function journey(user, seq) {
  // 1. Search — rotate route/date, skip empty days.
  const flightId = await timed('search', async () => {
    for (let attempt = 0; attempt < ROUTES.length; attempt++) {
      const [origin, destination] = pick(ROUTES);
      const date = new Date(Date.now() + pick(DAY_OFFSETS) * 86_400_000).toISOString().slice(0, 10);
      const res = await call(
        user,
        `/api/v1/flights/search?origin=${origin}&destination=${destination}&date=${date}`,
        { expect: 200 },
      );
      const results = res.body?.results ?? [];
      if (results.length > 0) return pick(results).flightId;
    }
    throw new Error('no seeded flights found on any rotated route/date');
  });

  // 2. Book (holds seats, returns PNR).
  const booking = await timed('book', async () => {
    const res = await call(user, '/api/v1/bookings', {
      method: 'POST',
      expect: 201,
      body: {
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Soak', lastName: `Rider${seq}` }],
        contactEmail: user.email,
        contactPhone: user.phone,
      },
    });
    return res.body;
  });

  // 3. Start M-Pesa STK push.
  const payment = await timed('pay', async () => {
    const res = await call(user, '/api/v1/payments', {
      method: 'POST',
      expect: 201,
      body: { bookingId: booking.id },
    });
    return res.body;
  });

  // 4. Mock provider: simulate the customer entering their PIN (result 0).
  await timed('simulate', () =>
    call(user, `/api/v1/payments/${payment.id}/simulate`, {
      method: 'POST',
      expect: 200,
      body: { resultCode: 0 },
    }),
  );

  // 5. Wait for the async queue to confirm the booking.
  await timed('confirm', async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const res = await call(user, `/api/v1/bookings/${booking.id}`, { expect: 200 });
      if (res.body?.status === 'CONFIRMED') return;
      if (Date.now() > deadline) throw new Error(`booking stuck at ${res.body?.status}`);
      await sleep(200);
    }
  });

  // 6. Issue tickets.
  await timed('issue', () =>
    call(user, '/api/v1/ticketing/issue', {
      method: 'POST',
      expect: 201,
      body: { bookingId: booking.id },
    }),
  );
}

function report(journeys) {
  const all = [];
  const lines = ['', 'op          count   err      p50       p95       max'];
  for (const [op, { samples, errors }] of [...ops.entries()].sort()) {
    const sorted = [...samples].sort((a, b) => a - b);
    all.push(...samples);
    lines.push(
      `${op.padEnd(11)} ${String(samples.length).padStart(5)}   ` +
        `${String(errors).padStart(4)}    ${fmt(percentile(sorted, 50)).padStart(7)}   ` +
        `${fmt(percentile(sorted, 95)).padStart(7)}   ${fmt(sorted.at(-1) ?? 0).padStart(7)}`,
    );
  }
  const sortedAll = [...all].sort((a, b) => a - b);
  const errorPct = journeys.attempted === 0 ? 100 : (journeys.failed / journeys.attempted) * 100;
  const p95 = percentile(sortedAll, 95);

  lines.push('');
  lines.push(
    `journeys: ${journeys.completed}/${journeys.attempted} completed ` +
      `(${errorPct.toFixed(1)}% errors, ${journeys.rate.toFixed(2)} journeys/s) · ` +
      `${all.length} requests · overall p95 ${fmt(p95)}`,
  );
  const errorOk = errorPct <= MAX_ERROR_PCT;
  const p95Ok = p95 <= MAX_P95_MS;
  lines.push(
    `thresholds: error ≤${MAX_ERROR_PCT}% ${errorOk ? '✓' : '✗'} · ` +
      `p95 ≤${MAX_P95_MS}ms ${p95Ok ? '✓' : '✗'}`,
  );
  lines.push(errorOk && p95Ok ? 'PASS' : 'FAIL');
  return { ok: errorOk && p95Ok, text: lines.join('\n') };
}

async function main() {
  console.log(
    `soak: ${USERS} users × ${DURATION_S}s against ${API} ` +
      `(thresholds: errors ≤${MAX_ERROR_PCT}%, p95 ≤${MAX_P95_MS}ms)`,
  );

  // Readiness — fail fast when the stack is down (exit 2, not a false FAIL).
  try {
    await call(null, '/healthz', { expect: 200 });
    await call(null, '/api/v1/meta', { expect: 200 });
  } catch (err) {
    console.error(`soak: stack is not ready — ${err.message}`);
    process.exit(2);
  }

  // Setup: register one account per user (outside the measured window).
  const stamp = Date.now();
  const setupStart = performance.now();
  try {
    await Promise.all(
      Array.from({ length: USERS }, async (_, i) => {
        const email = `soak+${stamp}-${i}@kenyaairways.example`;
        const phone = `+2547${String(randomInt(1e8)).padStart(8, '0')}`;
        const user = { email, phone, cookie: null };
        await call(user, '/api/v1/auth/register', {
          method: 'POST',
          expect: 201,
          body: {
            email,
            phone,
            password: 'SoakPassw0rd!',
            firstName: 'Soak',
            lastName: `User${i}`,
            acceptTerms: true,
          },
        });
        users.push(user);
      }),
    );
  } catch (err) {
    console.error(`soak: setup failed — ${err.message}`);
    process.exit(2);
  }
  console.log(`setup: ${USERS} users registered in ${fmt(performance.now() - setupStart)}`);

  // Measured window.
  const deadline = Date.now() + DURATION_S * 1000;
  const journeys = { attempted: 0, failed: 0, completed: 0, rate: 0 };
  await Promise.all(
    users.map(async (user, u) => {
      let seq = u;
      while (Date.now() < deadline) {
        journeys.attempted += 1;
        seq += USERS;
        try {
          await journey(user, seq);
          journeys.completed += 1;
        } catch (err) {
          journeys.failed += 1;
          const key = String(err.message).slice(0, 160);
          if (!ops.has(`fail:${key}`)) console.log(`journey failed: ${key}`);
        }
      }
    }),
  );
  journeys.rate = journeys.completed / (DURATION_S || 1);

  const { ok, text } = report(journeys);
  console.log(text);
  process.exit(ok ? 0 : 1);
}

const users = [];
main().catch((err) => {
  console.error(`soak: fatal — ${err.stack ?? err}`);
  process.exit(2);
});
