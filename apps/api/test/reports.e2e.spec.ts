import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { getEnv } from '../src/config/env';

function cookieHeader(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

const stamp = Date.now().toString(36);
const digits8 = (offset = 0) =>
  String((Date.now() % 100_000_000) + offset)
    .padStart(8, '0')
    .slice(-8);
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const dayAt = (days: number) => new Date(`${dateIn(days)}T00:00:00.000Z`);
const nairobiToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const shiftDay = (day: string, count: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};
/** expect.poll is test-only; beforeAll needs its own wait. */
const waitUntil = async (check: () => Promise<boolean>, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('condition not met within timeout');
};

/** M8: finance/ops reports — Nairobi-day revenue and per-flight load factor. */
describe('reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let financeCookie = '';
  let paxCookie = '';
  let flightId = '';
  let bookingTotalMinor = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    prisma = app.get(PrismaService);

    const stale = await app.get(RedisService).raw.keys('f13:rl:*');
    if (stale.length > 0) await app.get(RedisService).raw.del(...stale);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'finance@flight13.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    financeCookie = cookieHeader(login);

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `rep+${stamp}@flight13.example`,
        phone: `+2547${digits8(50)}`,
        password: 'Sup3rSecretPass',
        firstName: 'Report',
        lastName: `Rider${stamp}`,
        acceptTerms: true,
      })
      .expect(201);
    paxCookie = cookieHeader(register);

    const flight = await prisma.flight.findFirst({
      where: { flightDate: dayAt(26), status: 'SCHEDULED' },
      orderBy: { scheduledDepUtc: 'asc' },
    });
    expect(flight).not.toBeNull();
    flightId = flight!.id;

    // Paid booking so the revenue report has a known amount to include.
    const book = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', paxCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Report', lastName: `Rider${stamp}` }],
        contactEmail: `rep+${stamp}@flight13.example`,
      })
      .expect(201);
    bookingTotalMinor = book.body.totalMinor as number;
    expect(bookingTotalMinor).toBeGreaterThan(0);

    const pay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Cookie', paxCookie)
      .send({ bookingId: book.body.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${pay.body.id}/simulate`)
      .set('Cookie', paxCookie)
      .send({ resultCode: 0 })
      .expect(200);
    const bookingId = book.body.id as string;
    await waitUntil(
      async () =>
        (await prisma.booking.findUnique({ where: { id: bookingId } }))?.status === 'CONFIRMED',
      8_000,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('denies reports to a passenger', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue')
      .set('Cookie', paxCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/reports/load')
      .set('Cookie', paxCookie)
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/reports/revenue').expect(401);
  });

  it('validates the date range', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue')
      .query({ from: '10/09/2026' })
      .set('Cookie', financeCookie)
      .expect(422);

    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue')
      .query({ from: dateIn(2), to: dateIn(1) })
      .set('Cookie', financeCookie)
      .expect(422);

    await request(app.getHttpServer())
      .get('/api/v1/reports/load')
      .query({ from: dateIn(400), to: dateIn(800) }) // 400-day span > 366 cap
      .set('Cookie', financeCookie)
      .expect(422);
  });

  it('reports daily gross/net for the payment (Nairobi days)', async () => {
    const today = nairobiToday();
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue')
      .query({ from: shiftDay(today, -1), to: shiftDay(today, 1), currency: 'KES' })
      .set('Cookie', financeCookie)
      .expect(200);

    expect(res.body.currency).toBe('KES');
    expect(res.body.days).toHaveLength(3);
    for (const day of res.body.days) {
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.netMinor).toBe(day.grossMinor - day.refundMinor);
    }

    const { totals } = res.body;
    expect(totals.grossMinor).toBeGreaterThanOrEqual(bookingTotalMinor);
    expect(totals.payments).toBeGreaterThanOrEqual(1);
    expect(totals.netMinor).toBe(totals.grossMinor - totals.refundMinor);
  });

  it('reports load factor per flight for the day of departure', async () => {
    const day = dateIn(26);
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/load')
      .query({ from: day, to: day })
      .set('Cookie', financeCookie)
      .expect(200);

    expect(res.body.from).toBe(day);
    expect(res.body.to).toBe(day);
    const row = res.body.rows.find((r: { flightId: string }) => r.flightId === flightId);
    expect(row).toBeTruthy();
    expect(row.capacity).toBeGreaterThan(0);
    expect(row.seatsSold).toBeGreaterThanOrEqual(1);
    expect(row.seatsSold).toBeLessThanOrEqual(row.capacity);
    expect(row.loadFactorPct === null || typeof row.loadFactorPct === 'number').toBe(true);
    expect(res.body.totals.flights).toBeGreaterThanOrEqual(1);

    const nbo = await request(app.getHttpServer())
      .get('/api/v1/reports/load')
      .query({ from: day, to: day, origin: 'nbo' })
      .set('Cookie', financeCookie)
      .expect(200);
    for (const r of nbo.body.rows) expect(r.originCode).toBe('NBO');

    const none = await request(app.getHttpServer())
      .get('/api/v1/reports/load')
      .query({ from: day, to: day, origin: 'ZZZ' })
      .set('Cookie', financeCookie)
      .expect(200);
    expect(none.body.rows).toEqual([]);
  });
});
