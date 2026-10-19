import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { getEnv } from '../src/config/env';

const stamp = Date.now().toString(36);
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function cookieHeader(res: Response): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => c.split(';')[0]);
}

/**
 * Standalone admin console backend: live app name + any-image keys, the fare
 * manager (per-class edits, filtered percent bulk) and the assistance desk
 * (find any booking, take cash directly, issue) — plus role guards.
 */
describe('admin console (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie = '';
  let passengerCookie = '';
  let server: ReturnType<typeof request>;

  const email = `e2e+adminconsole+${stamp}@flight13.example`;
  const password = 'Sup3rSecretPass';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(RedisService).clearKeys('f13:rl:*');
    server = request(app.getHttpServer());

    const admin = await server
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@flight13.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    adminCookie = cookieHeader(admin).join('; ');

    const passenger = await server
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'Walkin',
        lastName: 'Customer',
        acceptTerms: true,
      })
      .expect(201);
    passengerCookie = cookieHeader(passenger).join('; ');
  });

  afterAll(async () => {
    if (!app) return;
    // Restore the singleton site settings the suite mutates.
    await request(app.getHttpServer())
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: 'Flight13', images: {} });
    // Remove the walk-up booking without leaving inventory drift.
    const bookings = await prisma.booking.findMany({
      where: { contactEmail: { contains: `adminconsole+${stamp}` } },
      include: { segments: true },
    });
    for (const booking of bookings) {
      const seats = booking.adultCount + booking.childCount;
      const confirmed = ['CONFIRMED', 'CHECKED_IN', 'FLOWN'].includes(booking.status);
      await prisma.seatHold.deleteMany({ where: { bookingId: booking.id } });
      for (const seg of booking.segments) {
        // Mirror the release path: confirmed bookings consumed sold seats,
        // unpaid ones still hold reserved seats.
        await prisma.inventory.updateMany({
          where: { flightId: seg.flightId, fareClassId: seg.fareClassId },
          data: confirmed
            ? { seatsSold: { decrement: seats } }
            : { seatsHeld: { decrement: seats } },
        });
      }
      await prisma.booking.deleteMany({ where: { id: booking.id } });
    }
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  // ── live app name + any-image keys ───────────────────────────────────────

  it('renames the app and the new name shows on the public settings', async () => {
    const name = `Skyline Air ${stamp}`;
    const patched = await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: name })
      .expect(200);
    expect(patched.body.appName).toBe(name);

    const pub = await server.get('/api/v1/site-settings').expect(200);
    expect(pub.body.appName).toBe(name);
  });

  it('rejects an empty or oversized app name', async () => {
    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: '   ' })
      .expect(422); // VALIDATION_ERROR
    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: 'x'.repeat(41) })
      .expect(422);
  });

  it('stores arbitrary section image keys and rejects malformed ones', async () => {
    const url = `https://images.example.com/explore-${stamp}.jpg`;
    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ images: { explore: url } })
      .expect(200);
    const pub = await server.get('/api/v1/site-settings').expect(200);
    expect(pub.body.images.explore).toBe(url);

    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ images: { 'Bad Key!': url } })
      .expect(422); // VALIDATION_ERROR
  });

  // ── fare manager ─────────────────────────────────────────────────────────

  it('lists flights with every fare class for the price manager', async () => {
    const res = await server
      .get('/api/v1/admin/flights')
      .query({ origin: 'NBO', destination: 'CDG' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const flight = res.body[0];
    expect(flight.flightNumber).toMatch(/^F\d{4,5}$/);
    expect(flight.flightDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(flight.fares.length).toBeGreaterThan(1);
    for (const fare of flight.fares) {
      expect(fare.baseFareMinor).toBeGreaterThan(0);
      expect(fare.currency).toBe('KES');
    }
  });

  it('edits one flight per fare class and leaves the other classes alone', async () => {
    const list = await server
      .get('/api/v1/admin/flights')
      .query({ origin: 'NBO', destination: 'CDG' })
      .set('Cookie', adminCookie)
      .expect(200);
    const target = list.body[0];
    const saver = target.fares.find((f: { fareClassCode: string }) => f.fareClassCode === 'SAVER');
    const others = target.fares.filter(
      (f: { fareClassCode: string }) => f.fareClassCode !== 'SAVER',
    );
    expect(saver).toBeTruthy();
    expect(others.length).toBeGreaterThan(0);

    const next = saver.baseFareMinor + 123_400;
    await server
      .patch(`/api/v1/admin/flights/${target.flightId}/fares`)
      .set('Cookie', adminCookie)
      .send({ fares: [{ fareClassCode: 'SAVER', baseFareMinor: next }] })
      .expect(200);

    const after = await server
      .get('/api/v1/admin/flights')
      .query({ origin: 'NBO', destination: 'CDG' })
      .set('Cookie', adminCookie)
      .expect(200);
    const updated = after.body.find((f: { flightId: string }) => f.flightId === target.flightId);
    const updatedSaver = updated.fares.find(
      (f: { fareClassCode: string }) => f.fareClassCode === 'SAVER',
    );
    expect(updatedSaver.baseFareMinor).toBe(next);
    for (const fare of others) {
      const now = updated.fares.find(
        (f: { fareClassCode: string }) => f.fareClassCode === fare.fareClassCode,
      );
      expect(now.baseFareMinor).toBe(fare.baseFareMinor);
    }

    // Restore the original so the shared demo data stays exact.
    await server
      .patch(`/api/v1/admin/flights/${target.flightId}/fares`)
      .set('Cookie', adminCookie)
      .send({ fares: [{ fareClassCode: 'SAVER', baseFareMinor: saver.baseFareMinor }] })
      .expect(200);
  });

  it('runs a filtered percent change and restores every original fare', async () => {
    const day = dateIn(4);
    const query = { origin: 'NBO', destination: 'CDG', dateFrom: day, dateTo: day };
    const body = { originCode: 'NBO', destinationCode: 'CDG', dateFrom: day, dateTo: day };
    const before = await server
      .get('/api/v1/admin/flights')
      .query(query)
      .set('Cookie', adminCookie)
      .expect(200);
    if (before.body.length === 0) return; // no service that day — nothing to prove
    const snapshot = before.body;

    // Zero percent proves the plumbing without touching the data.
    const noop = await server
      .post('/api/v1/admin/flights/bulk-prices')
      .set('Cookie', adminCookie)
      .send({ ...body, operation: 'ADJUST_PERCENT', value: 0 })
      .expect(201);
    expect(noop.body.flightsUpdated).toBe(snapshot.length);
    expect(noop.body.faresUpdated).toBe(0);

    const moved = await server
      .post('/api/v1/admin/flights/bulk-prices')
      .set('Cookie', adminCookie)
      .send({ ...body, operation: 'ADJUST_PERCENT', value: 2 })
      .expect(201);
    expect(moved.body.flightsUpdated).toBe(snapshot.length);
    expect(moved.body.faresUpdated).toBeGreaterThan(0);

    const during = await server
      .get('/api/v1/admin/flights')
      .query(query)
      .set('Cookie', adminCookie)
      .expect(200);

    // Restore exact originals right away — assertions below read the captured
    // snapshots, so the shared demo data is only transiently off.
    for (const flight of snapshot) {
      await server
        .patch(`/api/v1/admin/flights/${flight.flightId}/fares`)
        .set('Cookie', adminCookie)
        .send({
          fares: flight.fares.map((f: { fareClassCode: string; baseFareMinor: number }) => ({
            fareClassCode: f.fareClassCode,
            baseFareMinor: f.baseFareMinor,
          })),
        })
        .expect(200);
    }

    const first = during.body[0].fares[0];
    expect(first.baseFareMinor).toBeGreaterThanOrEqual(snapshot[0].fares[0].baseFareMinor * 1.01);
  });

  it('keeps the price manager closed to passengers', async () => {
    await server.get('/api/v1/admin/flights').set('Cookie', passengerCookie).expect(403);
    await server
      .post('/api/v1/admin/flights/bulk-prices')
      .set('Cookie', passengerCookie)
      .send({ operation: 'ADJUST_PERCENT', value: -99 })
      .expect(403);
  });

  // ── assistance desk: pay directly + issue ────────────────────────────────

  let bookingId = '';
  let pnr = '';

  it('books a walk-up customer one way', async () => {
    const search = await server
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(5), adults: 1 })
      .expect(200);
    const option = search.body.results[0];
    const res = await server
      .post('/api/v1/bookings')
      .set('Cookie', passengerCookie)
      .send({
        tripType: 'ONE_WAY',
        source: 'WEB',
        segments: [
          { flightId: option.flightId, fareClassCode: option.fareOptions[0].fareClass.code },
        ],
        passengers: [{ type: 'ADULT', firstName: 'Walkin', lastName: 'Customer' }],
        contactEmail: email,
      })
      .expect(201);
    bookingId = res.body.id;
    pnr = res.body.pnr;
    expect(pnr).toHaveLength(6);
  });

  it('takes cash directly and confirms the booking', async () => {
    const res = await server
      .post(`/api/v1/admin/bookings/${bookingId}/pay`)
      .set('Cookie', adminCookie)
      .send({ provider: 'CASH', reference: `DRAWER-${stamp}` })
      .expect(201);
    expect(res.body.status).toBe('PAID');
    expect(res.body.provider).toBe('CASH');

    const booking = await server
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(booking.body.status).toBe('CONFIRMED');
  });

  it('refuses to settle the same booking twice', async () => {
    await server
      .post(`/api/v1/admin/bookings/${bookingId}/pay`)
      .set('Cookie', adminCookie)
      .send({ provider: 'CASH' })
      .expect(409);
  });

  it('issues tickets for the confirmed booking', async () => {
    const res = await server
      .post('/api/v1/ticketing/issue')
      .set('Cookie', adminCookie)
      .send({ bookingId })
      .expect(201);
    expect(res.body.tickets.length).toBe(1);
    expect(res.body.alreadyIssued).toBe(false);

    const replay = await server
      .post('/api/v1/ticketing/issue')
      .set('Cookie', adminCookie)
      .send({ bookingId })
      .expect(201);
    expect(replay.body.alreadyIssued).toBe(true);
  });

  it('finds the booking by PNR and passenger name, marked paid', async () => {
    const byPnr = await server
      .get('/api/v1/admin/bookings')
      .query({ q: pnr })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byPnr.body).toHaveLength(1);
    expect(byPnr.body[0]).toMatchObject({
      pnr,
      status: 'CONFIRMED',
      paid: true,
      route: 'NBO → MBA',
      passengerNames: ['Walkin Customer'],
    });

    const byName = await server
      .get('/api/v1/admin/bookings')
      .query({ q: 'walkin customer' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(byName.body.some((b: { pnr: string }) => b.pnr === pnr)).toBe(true);
  });

  it('keeps the assistance desk closed to passengers', async () => {
    await server.get('/api/v1/admin/bookings').set('Cookie', passengerCookie).expect(403);
    await server
      .post(`/api/v1/admin/bookings/${bookingId}/pay`)
      .set('Cookie', passengerCookie)
      .send({ provider: 'CASH' })
      .expect(403);
  });
});
