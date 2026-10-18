import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { ACCESS_COOKIE } from '../src/modules/auth/token.service';

const stamp = Date.now().toString(36);
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const monthNow = () => new Date().toISOString().slice(0, 7);

function cookieHeader(res: Response): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => c.split(';')[0]);
}

/** Fare calendar + status board + CO₂/advice enrichment + price alerts. */
describe('worldwide extras (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessionCookie = '';
  const email = `e2e+calendar+${stamp}@flight13.example`;
  const password = 'Sup3rSecretPass';
  let searchFlight: Record<string, any>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(RedisService).clearKeys('f13:rl:*');
  });

  afterAll(async () => {
    await prisma.priceAlert.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app?.close();
  });

  it('search enriches flights with CO₂ per passenger and a fare-trend verdict', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(3), adults: 1 })
      .expect(200);
    expect(res.body.results.length).toBeGreaterThan(0);

    searchFlight = res.body.results[0];
    expect(searchFlight.co2KgPerPax).toBeGreaterThan(0);
    expect(Number.isInteger(searchFlight.co2KgPerPax)).toBe(true);
    expect(['BOOK_NOW', 'WAIT', 'FAIR']).toContain(searchFlight.priceAdvice?.verdict);
    expect(searchFlight.priceAdvice?.confidencePct).toBeGreaterThanOrEqual(50);
    expect(searchFlight.priceAdvice?.confidencePct).toBeLessThanOrEqual(95);
  });

  it('returns a whole-month fare calendar with per-day lows and a best date', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/calendar')
      .query({ origin: 'NBO', destination: 'MBA', month: monthNow() })
      .expect(200);

    const body = res.body;
    expect(body).toMatchObject({ origin: 'NBO', destination: 'MBA', month: monthNow() });
    expect(body.currency).toBe('KES');
    const daysInMonth = new Date(
      Number(monthNow().slice(0, 4)),
      Number(monthNow().slice(5, 7)),
      0,
    ).getDate();
    expect(body.days).toHaveLength(daysInMonth);

    const withFlights = body.days.filter((d: any) => d.flightCount > 0);
    expect(withFlights.length).toBeGreaterThan(0);
    for (const day of withFlights) {
      expect(day.lowestTotalMinor).toBeGreaterThan(0);
    }
    expect(body.bestDate).toBeTruthy();
    const best = body.days.find((d: any) => d.date === body.bestDate);
    expect(best.lowestTotalMinor).toBe(
      Math.min(...withFlights.map((d: any) => d.lowestTotalMinor).filter((n: number) => n > 0)),
    );
  });

  it('rejects a malformed calendar request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/flights/calendar')
      .query({ origin: 'NBO', destination: 'NBO', month: monthNow() })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/flights/calendar')
      .query({ origin: 'NBO', destination: 'MBA', month: 'soon' })
      .expect(400);
  });

  it('looks a flight up on the status board by number (+date)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/status-board')
      .query({ flightNumber: searchFlight.flightNumber, date: dateIn(3) })
      .expect(200);

    expect(res.body).toMatchObject({
      flightNumber: searchFlight.flightNumber,
      origin: { code: 'NBO' },
      destination: { code: 'MBA' },
      status: searchFlight.status,
    });
    // Airport-local wall-clock (ISO with the airport's UTC offset).
    expect(res.body.scheduledDepLocal).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
    expect(res.body.estimatedDepLocal).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
    expect(typeof res.body.delayMinutes).toBe('number');
  });

  it('404s the status board for an unknown flight number', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/flights/status-board')
      .query({ flightNumber: 'F99999', date: dateIn(3) })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/flights/status-board')
      .query({ flightNumber: '' })
      .expect(400);
  });

  it('requires a session to track fares', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/price-alerts')
      .send({ originCode: 'NBO', destinationCode: 'MBA' })
      .expect(401);
  });

  it('creates, lists, deduplicates and cancels a price alert', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'Trend',
        lastName: 'Watcher',
        acceptTerms: true,
      })
      .expect(201);
    expect(reg.headers['set-cookie']).toBeDefined();
    sessionCookie = cookieHeader(reg).join('; ');
    expect(sessionCookie).toContain(`${ACCESS_COOKIE}=`);

    const created = await request(app.getHttpServer())
      .post('/api/v1/price-alerts')
      .set('Cookie', sessionCookie)
      .send({ originCode: 'nbo', destinationCode: 'cdg', cabin: 'ECONOMY' })
      .expect(201);
    expect(created.body).toMatchObject({
      originCode: 'NBO',
      destinationCode: 'CDG',
      cabin: 'ECONOMY',
      status: 'ACTIVE',
      targetMinor: null,
    });

    // Watching the same route twice is a conflict, not a second alert.
    await request(app.getHttpServer())
      .post('/api/v1/price-alerts')
      .set('Cookie', sessionCookie)
      .send({ originCode: 'NBO', destinationCode: 'CDG' })
      .expect(409);

    const list = await request(app.getHttpServer())
      .get('/api/v1/price-alerts')
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
    const alertId = list.body[0].id;

    await request(app.getHttpServer())
      .delete(`/api/v1/price-alerts/${alertId}`)
      .set('Cookie', sessionCookie)
      .expect(204);

    const afterCancel = await request(app.getHttpServer())
      .get('/api/v1/price-alerts')
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(afterCancel.body).toHaveLength(0);
  });

  it('rejects an alert on the same origin/destination', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/price-alerts')
      .set('Cookie', sessionCookie)
      .send({ originCode: 'NBO', destinationCode: 'nbo' })
      .expect(400);
  });

  it('the daily watch detects the seeded route without crashing', async () => {
    // Exercise checkOnce() directly — the BullMQ scheduler runs it daily.
    const { PriceAlertsService } = await import('../src/modules/price-alerts/price-alerts.service');
    const service = app.get(PriceAlertsService);
    const result = await service.checkOnce();
    expect(result).toHaveProperty('checked');
    expect(result).toHaveProperty('triggered');
    expect(Number.isInteger(result.checked)).toBe(true);
    expect(result.triggered).toBeGreaterThanOrEqual(0);
    expect(result.triggered).toBeLessThanOrEqual(result.checked);
  });
});
