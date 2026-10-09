import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';

/**
 * The core correctness property of the platform: two travellers can never buy
 * the same seat. Inventory is reserved with a single conditional UPDATE whose
 * availability predicate is evaluated under the row lock — races lose, they
 * never double-sell. These tests hammer that path with real concurrency.
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

describe('booking concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie = '';
  let flightId = '';
  let seatLabel = '';
  let seatMapId = '';
  const createdIds: string[] = [];
  const inventorySnapshot: Array<{
    id: string;
    seatsTotal: number;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];

  const bookingPayload = (fareClassCode: string) => ({
    tripType: 'ONE_WAY',
    segments: [{ flightId, fareClassCode }],
    passengers: [{ type: 'ADULT', firstName: 'Race', lastName: 'Condition' }],
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `cc+${stamp}@flight13.example`,
        phone: `+2547${digits8(9)}`,
        password: 'Sup3rSecretPass',
        firstName: 'Concur',
        lastName: 'Rency',
        acceptTerms: true,
      })
      .expect(201);
    cookie = cookieHeader(reg);

    // A dedicated flight far from other specs' dates.
    const search = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(21) })
      .expect(200);
    const first = search.body.results[0];
    expect(first, 'seeded NBO→MBA flight must exist').toBeTruthy();
    flightId = first!.flightId;

    const full = await prisma.flight.findUnique({
      where: { id: flightId },
      include: {
        aircraft: { include: { aircraftType: { include: { seatMap: true } } } },
        inventory: { include: { fareClass: true } },
      },
    });
    seatMapId = full!.aircraft!.aircraftType.seatMap!.id;
    const seat = await prisma.seat.findFirst({
      where: { seatMapId, active: true, blocked: false },
      orderBy: { row: 'asc' },
    });
    seatLabel = seat!.label;

    // Crashed/partial previous runs can leave ACTIVE holds — start clean.
    await prisma.seatHold.deleteMany({ where: { flightId } });

    // Snapshot every row so this spec restores the DB exactly as it found it.
    for (const row of full!.inventory) {
      inventorySnapshot.push({
        id: row.id,
        seatsTotal: row.seatsTotal,
        seatsHeld: row.seatsHeld,
        seatsSold: row.seatsSold,
        seatsBlocked: row.seatsBlocked,
      });
    }
    // Shrunk arena: CLASSIC sells exactly 4 seats, SAVER exactly 6.
    for (const row of full!.inventory) {
      const capacity =
        row.fareClass.code === 'CLASSIC' ? 4 : row.fareClass.code === 'SAVER' ? 6 : 0;
      await prisma.inventory.update({
        where: { id: row.id },
        data: { seatsTotal: capacity, seatsHeld: 0, seatsSold: 0, seatsBlocked: 0 },
      });
    }
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.seatHold.deleteMany({ where: { flightId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `cc+${stamp}` } } });
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

  it('sells exactly the available capacity under 16 parallel bookings — never more', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 16 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set('Cookie', cookie)
          .send(bookingPayload('CLASSIC')),
      ),
    );

    const created = attempts.filter((r) => r.status === 201);
    const rejected = attempts.filter((r) => r.status === 409);

    expect(created).toHaveLength(4); // capacity was 4
    expect(rejected).toHaveLength(12);
    for (const res of rejected) expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
    createdIds.push(...created.map((r) => r.body.id as string));

    // All winners got distinct PNRs and the loser-tally is exact.
    const pnrSet = new Set(created.map((r) => r.body.pnr as string));
    expect(pnrSet.size).toBe(created.length);

    // The inventory reflects exactly the winners: 4 held, 0 available.
    const inv = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'CLASSIC' } },
    });
    expect(inv.seatsHeld).toBe(4);
    expect(inv.seatsTotal - inv.seatsHeld - inv.seatsSold - inv.seatsBlocked).toBe(0);

    // And no booking exists without a matching reservation (audit the totals).
    const bookings = await prisma.booking.findMany({
      where: { id: { in: createdIds }, segments: { some: { flightId, fareClassId: { not: '' } } } },
    });
    expect(bookings).toHaveLength(4);
    expect(bookings.every((b) => b.status === 'HELD')).toBe(true);
  });

  it('still rejects every request once the flight is full', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set('Cookie', cookie)
          .send(bookingPayload('CLASSIC')),
      ),
    );
    for (const res of attempts) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');
    }
  });

  it('lets exactly one of three parallel requests hold the same seat', async () => {
    // Three separate bookings racing for one physical seat.
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Cookie', cookie)
        .send(bookingPayload('SAVER'))
        .expect(201);
      createdIds.push(res.body.id);
    }
    const ids = createdIds.slice(-3);

    const attempts = await Promise.all(
      ids.map((id) =>
        request(app.getHttpServer())
          .post(`/api/v1/bookings/${id}/seats`)
          .set('Cookie', cookie)
          .send({ seatLabel, segmentSeq: 0 }),
      ),
    );

    const won = attempts.filter((r) => r.status === 200);
    const lost = attempts.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(2);
    for (const res of lost) expect(res.body.error.code).toBe('SEAT_UNAVAILABLE');

    // Exactly one ACTIVE hold exists for that seat on that flight.
    const holds = await prisma.seatHold.findMany({
      where: { flightId, status: 'ACTIVE', seat: { label: seatLabel } },
    });
    expect(holds).toHaveLength(1);
    expect([ids[0], ids[1], ids[2]]).toContain(holds[0].bookingId);
  });

  it('cancelling a winner returns the seat to the pool for others', async () => {
    const winner = createdIds[0];
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${winner}/cancel`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // Now the waitlisted request must succeed.
    const retry = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', cookie)
      .send(bookingPayload('CLASSIC'));
    expect(retry.status).toBe(201);
    createdIds.push(retry.body.id);

    const inv = await prisma.inventory.findFirstOrThrow({
      where: { flightId, fareClass: { code: 'CLASSIC' } },
    });
    expect(inv.seatsHeld).toBe(4); // 4 held again (3 old winners + 1 retry)
    expect(inv.seatsTotal - inv.seatsHeld - inv.seatsSold - inv.seatsBlocked).toBe(0);
  });
});
