import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { BookingsService } from '../src/modules/bookings/bookings.service';

const stamp = Date.now().toString(36);
const digits8 = (offset = 0) =>
  String((Date.now() % 100_000_000) + offset)
    .padStart(8, '0')
    .slice(-8);

function cookieHeader(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('bookings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bookings: BookingsService;
  let ownerCookie = '';
  let otherCookie = '';
  let flightId = '';
  let seatLabel = '';
  let inventoryBefore = { held: 0 };
  const inventorySnapshot: Array<{
    id: string;
    seatsTotal: number;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    bookings = app.get(BookingsService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    // Two passengers for owner/other access checks.
    const register = async (suffix: number) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `bk+${stamp}${suffix}@kenyaairways.example`,
          phone: `+2547${digits8(suffix)}`,
          password: 'Sup3rSecretPass',
          firstName: 'Book',
          lastName: `Tester${suffix}`,
          acceptTerms: true,
        })
        .expect(201);
      return cookieHeader(res);
    };
    ownerCookie = await register(1);
    otherCookie = await register(2);

    // A flight on a date that other specs don't touch, with a real seat label.
    const search = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(4) })
      .expect(200);
    const flight = search.body.results[0];
    expect(flight, 'seeded NBO→MBA flight must exist').toBeTruthy();
    flightId = flight!.flightId;

    const full = await prisma.flight.findUnique({
      where: { id: flightId },
      include: {
        aircraft: { include: { aircraftType: { include: { seatMap: true } } } },
        inventory: true,
      },
    });
    const saver = full!.inventory.find((i) => i.seatsTotal > 0)!;
    inventoryBefore = { held: saver.seatsHeld };
    for (const row of full!.inventory) {
      inventorySnapshot.push({
        id: row.id,
        seatsTotal: row.seatsTotal,
        seatsHeld: row.seatsHeld,
        seatsSold: row.seatsSold,
        seatsBlocked: row.seatsBlocked,
      });
    }
    // A crashed/partial previous run may have left ACTIVE holds — start clean.
    await prisma.seatHold.deleteMany({ where: { flightId } });
    const seat = await prisma.seat.findFirst({
      where: {
        seatMapId: full!.aircraft!.aircraftType.seatMap!.id,
        active: true,
        blocked: false,
        cabin: 'ECONOMY',
      },
      orderBy: { row: 'asc' },
    });
    seatLabel = seat!.label;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { contactEmail: { contains: `bk+${stamp}` } } });
    await prisma.seatHold.deleteMany({ where: { flightId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `bk+${stamp}` } } });
    for (const row of inventorySnapshot) {
      await prisma.inventory.update({
        where: { id: row.id },
        data: {
          seatsTotal: row.seatsTotal,
          seatsHeld: row.seatsHeld,
          seatsSold: row.seatsSold,
          seatsBlocked: row.seatsBlocked,
        },
      });
    }
    await app?.close();
  });

  let bookingId = '';

  it('rejects unauthenticated booking creation', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/bookings').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a HELD booking with a PNR, price breakdown and seat hold', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [
          {
            type: 'ADULT',
            firstName: 'Amina',
            lastName: 'Otieno',
            docType: 'PASSPORT',
            docNumber: 'A1234567',
          },
        ],
        seats: [{ segmentSeq: 0, seatLabel }],
      })
      .expect(201);

    const body = res.body;
    expect(body.status).toBe('HELD');
    expect(body.pnr).toHaveLength(6);
    expect(body.currency).toBe('KES');
    expect(body.segments).toHaveLength(1);
    expect(body.segments[0].flightId).toBe(flightId);
    expect(body.segments[0].departLocal).toMatch(/\+03:00$/);
    // Price integrity: breakdown sums exactly to the total, all integer minor units.
    const sum = body.breakdown.reduce(
      (acc: number, l: { amountMinor: number }) => acc + l.amountMinor,
      0,
    );
    expect(sum).toBe(body.totalMinor);
    expect(Number.isInteger(body.totalMinor)).toBe(true);
    expect(body.totalMinor).toBeGreaterThan(0);
    // Seat hold created and PII (doc numbers) never echoed back.
    expect(body.seatHolds).toHaveLength(1);
    expect(body.seatHolds[0]).toMatchObject({ seatLabel, status: 'ACTIVE' });
    expect(JSON.stringify(body.passengers)).not.toContain('A1234567');
    expect(body.passengers[0].docType).toBe('PASSPORT');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    bookingId = body.id;

    // Inventory actually moved.
    const inv = await prisma.inventory.findFirstOrThrow({ where: { flightId } });
    expect(inv.seatsHeld).toBeGreaterThanOrEqual(inventoryBefore.held + 1);

    // Document numbers are encrypted at rest (blind index is queryable).
    const row = await prisma.bookingPassenger.findFirstOrThrow({ where: { lastName: 'Otieno' } });
    expect(row.docNumberEncrypted).toMatch(/^v1\./);
    expect(row.docNumberHash).toHaveLength(64);
    expect(row.docNumberEncrypted).not.toContain('A1234567');
  });

  it('lists my bookings and hides them from other passengers', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.items.some((b: { id: string }) => b.id === bookingId)).toBe(true);

    const forbidden = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Cookie', otherCookie)
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    await request(app.getHttpServer()).get(`/api/v1/bookings/${bookingId}`).expect(401);
  });

  it('prevents a second booking from holding the same seat', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', otherCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Seat', lastName: 'Thief' }],
        seats: [{ segmentSeq: 0, seatLabel }],
      })
      .expect(409);
    expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
    expect(res.body.error.message).toContain(seatLabel);
  });

  it('releases a seat hold so another booking can take it', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/bookings/${bookingId}/seats/${seatLabel}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', otherCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Seat', lastName: 'Taker' }],
        seats: [{ segmentSeq: 0, seatLabel }],
      })
      .expect(201);
    // Cancel (releases inventory) then delete so later runs start from a clean seat.
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${res.body.id}/cancel`)
      .set('Cookie', otherCookie)
      .send({})
      .expect(200);
    await prisma.booking.delete({ where: { id: res.body.id } });
  });

  it('rejects invalid booking payloads with the shared error envelope', async () => {
    const noAdult = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'CHILD', firstName: 'Kid', lastName: 'Only' }],
      })
      .expect(400);
    expect(noAdult.body.error.code).toBe('BAD_REQUEST');

    const badFare = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'nope' }],
        passengers: [{ type: 'ADULT', firstName: 'A', lastName: 'B' }],
      })
      .expect(422);
    expect(badFare.body.error.code).toBe('VALIDATION_ERROR');

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId: 'nope', fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'A', lastName: 'B' }],
      })
      .expect(404);
  });

  it('cancels a booking and returns its held seats', async () => {
    const invBefore = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'SAVER' } },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Cookie', ownerCookie)
      .send({ reason: 'plans changed' })
      .expect(200);
    expect(res.body.status).toBe('CANCELLED');

    const invAfter = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'SAVER' } },
    });
    expect(invAfter.seatsHeld).toBe(invBefore.seatsHeld - 1);

    // Cancelling twice is an invalid transition, not a double release.
    const again = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Cookie', ownerCookie)
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('expires overdue bookings and frees their inventory (sweeper)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'CLASSIC' }],
        passengers: [{ type: 'ADULT', firstName: 'Slow', lastName: 'Payer' }],
      })
      .expect(201);
    const expiringId = res.body.id as string;

    const invBefore = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'CLASSIC' } },
    });

    await prisma.booking.update({
      where: { id: expiringId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const swept = await bookings.expireDue();
    expect(swept).toBeGreaterThanOrEqual(1);

    const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: expiringId } });
    expect(fresh.status).toBe('EXPIRED');

    const invAfter = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'CLASSIC' } },
    });
    expect(invAfter.seatsHeld).toBe(invBefore.seatsHeld - 1);

    // Idempotent: a second sweep finds nothing to do.
    const again = await bookings.expireDue();
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: expiringId } });
    expect(still.status).toBe('EXPIRED');
    expect(again).toBeGreaterThanOrEqual(0);
  });

  it('creates a ROUND_TRIP booking across two flights with per-segment fares', async () => {
    type Option = {
      flightId: string;
      fareOptions: Array<{ fareClass: { code: string }; pricing: { totalMinor: number } }>;
    };
    const totalOf = (o: Option, code: string) =>
      o.fareOptions.find((f) => f.fareClass.code === code)!.pricing.totalMinor;

    const outSearch = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(4) })
      .expect(200);
    const out = outSearch.body.results.find((r: Option) => r.flightId === flightId) as
      Option | undefined;
    expect(out, 'outbound flight must still be searchable').toBeTruthy();

    // The return leg on the first of a few candidate dates that has service.
    const retSearches = await Promise.all(
      [5, 6, 7].map((d) =>
        request(app.getHttpServer())
          .get('/api/v1/flights/search')
          .query({ origin: 'MBA', destination: 'NBO', date: dateIn(d) })
          .expect(200),
      ),
    );
    const ret = retSearches.map((s) => s.body.results[0] as Option | undefined).find(Boolean);
    expect(ret, 'seeded MBA→NBO return flight must exist within +5..+7 days').toBeTruthy();

    expect(out!.fareOptions.some((f) => f.fareClass.code === 'SAVER')).toBe(true);
    expect(ret!.fareOptions.some((f) => f.fareClass.code === 'FLEX')).toBe(true);

    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ROUND_TRIP',
        segments: [
          { flightId, fareClassCode: 'SAVER' },
          { flightId: ret!.flightId, fareClassCode: 'FLEX' },
        ],
        passengers: [
          { type: 'ADULT', firstName: 'Robin', lastName: 'Njeri' },
          { type: 'ADULT', firstName: 'Robin', lastName: 'Kamau' },
        ],
      })
      .expect(201);

    expect(res.body.status).toBe('HELD');
    expect(res.body.segments).toHaveLength(2);
    expect(res.body.segments.map((s: { flightId: string }) => s.flightId)).toEqual([
      flightId,
      ret!.flightId,
    ]);
    // Every passenger flies every segment: total = (seg fares) × (passengers).
    expect(res.body.totalMinor).toBe((totalOf(out!, 'SAVER') + totalOf(ret!, 'FLEX')) * 2);
    const sum = res.body.breakdown.reduce(
      (acc: number, l: { amountMinor: number }) => acc + l.amountMinor,
      0,
    );
    expect(sum).toBe(res.body.totalMinor);

    // Cleanup: cancel (returns inventory on both flights) then delete.
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${res.body.id}/cancel`)
      .set('Cookie', ownerCookie)
      .send({ reason: 'e2e cleanup' })
      .expect(200);
    await prisma.booking.delete({ where: { id: res.body.id } });
  });
});
