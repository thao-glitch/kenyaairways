import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { type Env, __setEnvForTests, getEnv } from '../src/config/env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';

/**
 * M7: seat map, check-in window, seat allocation, boarding passes (BCBP).
 *
 * The check-in window is env-driven. This file widens the opening lead to a
 * baseline so +12-day flights are checkable, then each closed-window case
 * narrows one side via `withEnv(...)` and restores the baseline.
 */

const stamp = Date.now().toString(36);
const digits8 = (offset = 0) =>
  String((Date.now() % 100_000_000) + offset)
    .padStart(8, '0')
    .slice(-8);
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function cookieHeader(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

describe('check-in + boarding passes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie = '';
  let otherCookie = '';
  let flightA = '';
  let flightB = '';
  let seatA = '';
  let bookingA = { id: '', pnr: '' };
  let bookingB = { id: '', pnr: '' };
  let paxIdsB: string[] = [];
  let baseline: Env;

  const inventorySnapshot: Array<{
    id: string;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];

  /** Patch env for one assertion, always restoring the baseline. */
  async function withEnv<T>(patch: Partial<Env>, fn: () => Promise<T>): Promise<T> {
    __setEnvForTests({ ...baseline, ...patch });
    try {
      return await fn();
    } finally {
      __setEnvForTests(baseline);
    }
  }

  const register = async (suffix: number): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `ci+${stamp}${suffix}@kenyaairways.example`,
        phone: `+2547${digits8(80 + suffix)}`,
        password: 'Sup3rSecretPass',
        firstName: 'Ci',
        lastName: `Passenger${suffix}`,
        acceptTerms: true,
      })
      .expect(201);
    return cookieHeader(res);
  };

  const book = async (
    cookie: string,
    flightId: string,
    passengers: Array<{ firstName: string; lastName: string }>,
    suffix: number,
  ): Promise<{ id: string; pnr: string }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', cookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: passengers.map((p) => ({ type: 'ADULT', ...p })),
        contactEmail: `ci+${stamp}${suffix}@kenyaairways.example`,
      })
      .expect(201);
    return { id: res.body.id as string, pnr: res.body.pnr as string };
  };

  const payAndConfirm = async (cookie: string, bookingId: string): Promise<void> => {
    const pay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Cookie', cookie)
      .send({ bookingId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${pay.body.id}/simulate`)
      .set('Cookie', cookie)
      .send({ resultCode: 0 })
      .expect(200);
    await expect
      .poll(
        async () => {
          const row = await prisma.booking.findUnique({ where: { id: bookingId } });
          return row?.status;
        },
        { timeout: 5_000 },
      )
      .toBe('CONFIRMED');
  };

  const searchFlight = async (date: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date })
      .expect(200);
    const flight = res.body.results[0];
    expect(flight, `seeded NBO→MBA flight for ${date} must exist`).toBeTruthy();
    return flight.flightId as string;
  };

  beforeAll(async () => {
    // Deterministic baseline: the lead is wide open so these flights pass the
    // window; withEnv() narrows it for each closed-window assertion.
    baseline = { ...getEnv(), CHECK_IN_OPEN_HOURS: 999_999 };
    __setEnvForTests(baseline);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    ownerCookie = await register(1);
    otherCookie = await register(2);

    flightA = await searchFlight(dateIn(12));
    flightB = await searchFlight(dateIn(13));
    expect(flightA).not.toBe(flightB);

    for (const flightId of [flightA, flightB]) {
      const full = await prisma.flight.findUnique({
        where: { id: flightId },
        include: {
          aircraft: { include: { aircraftType: { include: { seatMap: true } } } },
          inventory: true,
        },
      });
      for (const row of full!.inventory) {
        inventorySnapshot.push({
          id: row.id,
          seatsHeld: row.seatsHeld,
          seatsSold: row.seatsSold,
          seatsBlocked: row.seatsBlocked,
        });
      }
      if (flightId === flightA) {
        const seat = await prisma.seat.findFirst({
          where: {
            seatMapId: full!.aircraft!.aircraftType.seatMap!.id,
            active: true,
            blocked: false,
            cabin: 'ECONOMY',
          },
          orderBy: [{ row: 'asc' }, { letter: 'asc' }],
        });
        expect(seat, 'seeded seat map must have an economy seat').toBeTruthy();
        seatA = seat!.label;
      }
    }
    await prisma.seatHold.deleteMany({ where: { flightId: { in: [flightA, flightB] } } });

    bookingA = await book(ownerCookie, flightA, [{ firstName: 'Solo', lastName: 'Traveler' }], 1);
    bookingB = await book(
      ownerCookie,
      flightB,
      [
        { firstName: 'Two', lastName: 'Passenger' },
        { firstName: 'Three', lastName: 'Passenger' },
      ],
      2,
    );
    paxIdsB = (
      await prisma.bookingPassenger.findMany({
        where: { bookingId: bookingB.id },
        orderBy: { seq: 'asc' },
        select: { id: true },
      })
    ).map((p) => p.id);
  });

  afterAll(async () => {
    if (!app) return;
    __setEnvForTests(baseline);
    await prisma.notification.deleteMany({
      where: { templateCode: 'checkin.completed', bookingId: { in: [bookingA.id, bookingB.id] } },
    });
    await prisma.ticket.deleteMany({ where: { bookingId: { in: [bookingA.id, bookingB.id] } } });
    await prisma.seatHold.deleteMany({ where: { flightId: { in: [flightA, flightB] } } });
    await prisma.booking.deleteMany({ where: { contactEmail: { contains: `ci+${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `ci+${stamp}` } } });
    for (const row of inventorySnapshot) {
      await prisma.inventory.update({
        where: { id: row.id },
        data: {
          seatsHeld: row.seatsHeld,
          seatsSold: row.seatsSold,
          seatsBlocked: row.seatsBlocked,
        },
      });
    }
    await app.close();
  });

  it('serves the seat map with derived availability (public)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/flights/${flightA}/seats`)
      .expect(200);
    expect(res.body.flightId).toBe(flightA);
    expect(res.body.seats.length).toBeGreaterThan(10);
    const statuses = new Set<string>(res.body.seats.map((s: { status: string }) => s.status));
    for (const status of statuses) {
      expect(['AVAILABLE', 'HELD', 'OCCUPIED', 'BLOCKED']).toContain(status);
    }
    expect(res.body.seats.every((s: { row: number }) => typeof s.row === 'number')).toBe(true);

    await request(app.getHttpServer()).get('/api/v1/flights/not-a-flight/seats').expect(404);
  });

  it('refuses check-in before the booking is confirmed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('requires issued tickets before check-in', async () => {
    await payAndConfirm(ownerCookie, bookingA.id);
    const res = await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(409);
    expect(res.body.error.message).toContain('Tickets must be issued');
  });

  it('enforces both sides of the check-in window', async () => {
    const tooEarly = await withEnv({ CHECK_IN_OPEN_HOURS: 1 }, () =>
      request(app.getHttpServer())
        .post('/api/v1/check-in')
        .set('Cookie', ownerCookie)
        .send({ bookingId: bookingA.id })
        .expect(409),
    );
    expect(tooEarly.body.error.code).toBe('CHECK_IN_CLOSED');
    expect(tooEarly.body.error.message).toContain('opens');

    const tooLate = await withEnv({ CHECK_IN_CLOSE_MINUTES: 999_999 }, () =>
      request(app.getHttpServer())
        .post('/api/v1/check-in')
        .set('Cookie', ownerCookie)
        .send({ bookingId: bookingA.id })
        .expect(409),
    );
    expect(tooLate.body.error.code).toBe('CHECK_IN_CLOSED');
    expect(tooLate.body.error.message).toContain('cutoff');
  });

  it('checks in, keeps the ticketed seat, flips the booking, and is idempotent', async () => {
    // Seat chosen before ticketing → the ticket carries it → check-in keeps it.
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingA.id}/seats`)
      .set('Cookie', ownerCookie)
      .send({ seatLabel: seatA })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(201);
    expect(res.body.bookingStatus).toBe('CHECKED_IN');
    expect(res.body.checkIns).toHaveLength(1);
    const checkIn = res.body.checkIns[0];
    expect(checkIn.status).toBe('CHECKED_IN');
    expect(checkIn.seatLabel).toBe(seatA); // paid seat survives check-in
    expect(checkIn.boardingSequence).toBe(1);
    expect(checkIn.checkedInAt).toBeTruthy();
    expect(checkIn.boardingPassId).toBeTruthy();

    // Idempotent: same row, same pass, no second assignment.
    const again = await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(201);
    expect(again.body.checkIns[0].id).toBe(checkIn.id);
    expect(again.body.checkIns[0].seatLabel).toBe(seatA);

    // The seat map now shows that seat as occupied.
    const map = await request(app.getHttpServer())
      .get(`/api/v1/flights/${flightA}/seats`)
      .expect(200);
    const seatRow = map.body.seats.find((s: { label: string }) => s.label === seatA);
    expect(seatRow.status).toBe('OCCUPIED');

    const list = await request(app.getHttpServer())
      .get('/api/v1/check-in')
      .query({ bookingId: bookingA.id })
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(list.body.checkIns).toHaveLength(1);
    await request(app.getHttpServer())
      .get('/api/v1/check-in')
      .query({ bookingId: bookingA.id })
      .set('Cookie', otherCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .expect(400); // authenticated, but bookingId is missing
  });

  it('serves the boarding pass with a well-formed IATA BCBP payload', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/check-in')
      .query({ bookingId: bookingA.id })
      .set('Cookie', ownerCookie)
      .expect(200);
    const passId = list.body.checkIns[0].boardingPassId as string;
    expect(passId).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/boarding-passes/${passId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.bcbp).toHaveLength(54);
    expect(res.body.bcbp.startsWith('M1')).toBe(true);
    expect(res.body.bcbp).toContain(bookingA.pnr.toUpperCase());
    expect(res.body.bcbp).toContain(seatA);
    expect(res.body.passengerName).toBe('Solo Traveler');
    expect(res.body.flightNumber).toBeTruthy();
    expect(res.body.departureUtc).toBeTruthy();

    // Owner yes, stranger no, unknown 404.
    await request(app.getHttpServer())
      .get(`/api/v1/boarding-passes/${passId}`)
      .set('Cookie', otherCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/boarding-passes/nope')
      .set('Cookie', ownerCookie)
      .expect(404);
  });

  it('allocates distinct seats and sequences for multi-passenger bookings', async () => {
    await payAndConfirm(ownerCookie, bookingB.id);
    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id, passengerIds: paxIdsB })
      .expect(201);
    expect(res.body.bookingStatus).toBe('CHECKED_IN');
    expect(res.body.checkIns).toHaveLength(2);
    const [first, second] = res.body.checkIns;
    expect(first.seatLabel).toBeTruthy();
    expect(second.seatLabel).toBeTruthy();
    expect(first.seatLabel).not.toBe(second.seatLabel);
    expect(new Set([first.boardingSequence, second.boardingSequence]).size).toBe(2);

    const passes = await Promise.all(
      res.body.checkIns.map((c: { boardingPassId: string }) =>
        request(app.getHttpServer())
          .get(`/api/v1/boarding-passes/${c.boardingPassId}`)
          .set('Cookie', ownerCookie)
          .expect(200),
      ),
    );
    const bcbps = passes.map((p) => p.body.bcbp as string);
    expect(new Set(bcbps).size).toBe(2); // distinct seats inside the barcodes
  });

  it('rejects a passenger id from another booking', async () => {
    const foreign = await prisma.bookingPassenger.findFirst({
      where: { bookingId: { not: bookingB.id } },
      select: { id: true },
    });
    expect(foreign).toBeTruthy();
    await request(app.getHttpServer())
      .post('/api/v1/check-in')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id, passengerIds: [foreign!.id] })
      .expect(400);
  });
});
