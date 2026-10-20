import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { type AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { getEnv } from '../src/config/env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';

/**
 * M6: real-time propagation + PNR + ticketing.
 *
 * The core proof: a payment flowing through `/payments` → `/simulate` must
 * reach a connected client as `payment.updated` + `booking.updated` over the
 * `/rt` Socket.IO namespace, with exactly one copy per socket (multi-room
 * dedupe), a room-authorization boundary, and Redis-stream replay for events
 * the client missed while offline.
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

/** The access token value out of the httpOnly `f13_at` cookie (WS handshake). */
function accessTokenFrom(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  const at = list.find((c) => c.startsWith('f13_at='));
  return at ? at.split(';')[0].slice('f13_at='.length) : '';
}

interface Seen {
  event: string;
  payload: Record<string, unknown>;
}

const TRACKED = [
  'ack',
  'error',
  'booking.updated',
  'payment.updated',
  'seat.held',
  'seat.released',
  'notification.new',
] as const;

function collect(socket: Socket): Seen[] {
  const seen: Seen[] = [];
  for (const event of TRACKED) {
    socket.on(event, (payload: Record<string, unknown>) => seen.push({ event, payload }));
  }
  return seen;
}

async function until<T>(
  probe: () => T | Promise<T | undefined | null | false> | undefined | null | false,
  label: string,
  ms = 8_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = await probe();
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('realtime + ticketing (e2e): /rt stream, PNR, e-ticket issuance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base = '';

  let ownerCookie = '';
  let ownerToken = '';
  let otherCookie = '';
  let otherToken = '';
  let opsCookie = '';
  let opsToken = '';

  let flightA = '';
  let flightB = '';
  let seatB = '';
  let bookingA = { id: '', pnr: '' };
  let bookingB = { id: '', pnr: '' };
  let lastEventId = '';

  const inventorySnapshot: Array<{
    id: string;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];

  const connect = (token: string): Socket =>
    io(`${base}/rt`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

  async function joinOk(socket: Socket, seen: Seen[], room: string): Promise<Seen> {
    socket.emit('room.join', { room });
    return until(
      () => seen.find((e) => e.event === 'ack' && e.payload.ref === room && e.payload.ok),
      `ack for ${room}`,
    );
  }

  async function book(flightId: string, suffix: number): Promise<{ id: string; pnr: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Real', lastName: `Time${suffix}` }],
        contactEmail: `rt+${stamp}${suffix}@kenyaairways.example`,
      })
      .expect(201);
    return { id: res.body.id as string, pnr: res.body.pnr as string };
  }

  async function searchFlight(date: string): Promise<string> {
    const search = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date })
      .expect(200);
    const flight = search.body.results[0];
    expect(flight, `seeded NBO→MBA flight for ${date} must exist`).toBeTruthy();
    return flight.flightId as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // Without the Socket.IO adapter the gateway would never attach — main.ts
    // does this in production boot, tests must mirror it.
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address || typeof address === 'string') {
      // Not listening yet — bind an ephemeral port for the ws client.
      await app.listen(0, '127.0.0.1');
    }
    const bound = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${bound.port}`;

    const register = async (suffix: number) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `rt+${stamp}${suffix}@kenyaairways.example`,
          phone: `+2547${digits8(70 + suffix)}`,
          password: 'Sup3rSecretPass',
          firstName: 'Real',
          lastName: `Time${suffix}`,
          acceptTerms: true,
        })
        .expect(201);
      return { cookie: cookieHeader(res), token: accessTokenFrom(res) };
    };
    const owner = await register(1);
    ownerCookie = owner.cookie;
    ownerToken = owner.token;
    const other = await register(2);
    otherCookie = other.cookie;
    otherToken = other.token;

    const ops = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'ops@kenyaairways.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    opsCookie = cookieHeader(ops);
    opsToken = accessTokenFrom(ops);

    flightA = await searchFlight(dateIn(10));
    flightB = await searchFlight(dateIn(11));
    expect(flightA).not.toBe(flightB);

    for (const flightId of [flightA, flightB]) {
      const full = await prisma.flight.findUnique({
        where: { id: flightId },
        include: { inventory: true },
      });
      for (const row of full!.inventory) {
        inventorySnapshot.push({
          id: row.id,
          seatsHeld: row.seatsHeld,
          seatsSold: row.seatsSold,
          seatsBlocked: row.seatsBlocked,
        });
      }
    }
    const withMap = await prisma.flight.findUnique({
      where: { id: flightB },
      include: { aircraft: { include: { aircraftType: { include: { seatMap: true } } } } },
    });
    const seat = await prisma.seat.findFirst({
      where: {
        seatMapId: withMap!.aircraft!.aircraftType.seatMap!.id,
        active: true,
        blocked: false,
        cabin: 'ECONOMY',
      },
      orderBy: [{ row: 'asc' }, { letter: 'asc' }],
    });
    expect(seat, 'seeded seat map must have an economy seat').toBeTruthy();
    seatB = seat!.label;
    // A crashed previous run may have left ACTIVE holds — start clean.
    await prisma.seatHold.deleteMany({ where: { flightId: { in: [flightA, flightB] } } });

    bookingA = await book(flightA, 1);
    bookingB = await book(flightB, 2);
  });

  afterAll(async () => {
    if (!app) return;
    await prisma.notification.deleteMany({
      where: { bookingId: { in: [bookingA.id, bookingB.id] } },
    });
    await prisma.ticket.deleteMany({ where: { bookingId: { in: [bookingA.id, bookingB.id] } } });
    await prisma.seatHold.deleteMany({ where: { flightId: { in: [flightA, flightB] } } });
    await prisma.booking.deleteMany({ where: { contactEmail: { contains: `rt+${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `rt+${stamp}` } } });
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

  it('rejects sockets without a valid access token', async () => {
    for (const auth of [undefined, 'not-a-jwt']) {
      const socket = io(`${base}/rt`, {
        ...(auth ? { auth: { token: auth } } : {}),
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      const seen = collect(socket);
      const events: string[] = [];
      socket.on('connect', () => events.push('connect'));
      socket.on('connect_error', () => events.push('connect_error'));
      socket.on('disconnect', () => events.push('disconnect'));
      await until(
        () => events.includes('disconnect') || events.includes('connect_error'),
        'handshake rejection',
      );
      expect(events).toContain('disconnect'); // never stays on an open stream
      expect(seen.some((e) => e.event === 'ack')).toBe(false); // no rooms, no traffic
      socket.close();
    }
  });

  it('authorizes room joins: own booking yes, someone else no, staff yes', async () => {
    const room = `booking:${bookingA.id}`;

    const owner = connect(ownerToken);
    const ownerSeen = collect(owner);
    await joinOk(owner, ownerSeen, room);

    const other = connect(otherToken);
    const otherSeen = collect(other);
    other.emit('room.join', { room });
    const denied = await until(
      () => otherSeen.find((e) => e.event === 'error' && e.payload.ref === room),
      'forbidden room error',
    );
    expect(denied.payload.code).toBe('FORBIDDEN');
    expect(otherSeen.some((e) => e.event === 'ack' && e.payload.ref === room)).toBe(false);

    const ops = connect(opsToken);
    const opsSeen = collect(ops);
    await joinOk(ops, opsSeen, room); // staff sees every booking

    other.emit('room.join', { room: 'bogus-room-format' });
    await until(() => otherSeen.find((e) => e.payload.code === 'FORBIDDEN'), 'bad room rejected');

    owner.emit('ping');
    const pong = await until(
      () => ownerSeen.find((e) => e.event === 'ack' && e.payload.ref === 'ping'),
      'ping ack',
    );
    expect(pong.payload.message).toBe('pong');

    owner.close();
    other.close();
    ops.close();
  });

  it('streams payment + booking state in real time, one copy per socket', async () => {
    const room = `booking:${bookingA.id}`;
    const owner = connect(ownerToken);
    const ownerSeen = collect(owner);
    await joinOk(owner, ownerSeen, room);

    // Second socket joins nothing: it must still receive events through the
    // auto-joined `user:{id}` room from the handshake.
    const userOnly = connect(ownerToken);
    const userSeen = collect(userOnly);

    const pay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingA.id })
      .expect(201);
    const paymentId = pay.body.id as string;
    expect(pay.body.status).toBe('REQUIRES_ACTION');

    await until(
      () =>
        ownerSeen.find(
          (e) =>
            e.event === 'payment.updated' &&
            e.payload.paymentId === paymentId &&
            e.payload.status === 'REQUIRES_ACTION',
        ),
      'payment.updated REQUIRES_ACTION',
    );

    const sim = await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    expect(sim.body.status).toBe('PAID');

    const paid = await until(
      () => ownerSeen.find((e) => e.event === 'payment.updated' && e.payload.status === 'PAID'),
      'payment.updated PAID',
    );
    const confirmed = await until(
      () =>
        ownerSeen.find(
          (e) =>
            e.event === 'booking.updated' &&
            e.payload.bookingId === bookingA.id &&
            e.payload.status === 'CONFIRMED',
        ),
      'booking.updated CONFIRMED',
    );
    expect(paid.payload.paymentId).toBe(paymentId);
    expect(confirmed.payload.pnr).toBe(bookingA.pnr);

    // Dedupe proof: the owner socket sits in BOTH booking and user rooms and
    // must still see each event exactly once.
    expect(
      ownerSeen.filter((e) => e.event === 'booking.updated' && e.payload.status === 'CONFIRMED'),
    ).toHaveLength(1);
    expect(
      ownerSeen.filter((e) => e.event === 'payment.updated' && e.payload.status === 'PAID'),
    ).toHaveLength(1);

    // The passive socket got the same event via its auto-joined user room.
    const userConfirmed = await until(
      () => userSeen.find((e) => e.event === 'booking.updated' && e.payload.status === 'CONFIRMED'),
      'user room booking.updated',
    );
    expect(userConfirmed.payload.eventId).toBe(confirmed.payload.eventId);

    lastEventId = confirmed.payload.eventId as string;
    expect(lastEventId).toMatch(/^\d+-\d+$/); // doubles as the replay cursor

    owner.close();
    userOnly.close();
  });

  it('broadcasts seat holds and releases to the flight room', async () => {
    const socket = connect(ownerToken);
    const seen = collect(socket);
    await joinOk(socket, seen, `flight:${flightB}`);

    const hold = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingB.id}/seats`)
      .set('Cookie', ownerCookie)
      .send({ seatLabel: seatB })
      .expect(200);
    expect(
      hold.body.seatHolds.some(
        (h: { seatLabel: string; status: string }) =>
          h.seatLabel === seatB && h.status === 'ACTIVE',
      ),
    ).toBe(true);

    const held = await until(
      () => seen.find((e) => e.event === 'seat.held' && e.payload.label === seatB),
      'seat.held event',
    );
    expect(held.payload.flightId).toBe(flightB);
    expect(held.payload.expiresAt).toBeTruthy();

    const release = await request(app.getHttpServer())
      .delete(`/api/v1/bookings/${bookingB.id}/seats/${seatB}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(
      release.body.seatHolds.some(
        (h: { seatLabel: string; status: string }) =>
          h.seatLabel === seatB && h.status === 'ACTIVE',
      ),
    ).toBe(false); // the row remains, but RELEASED

    await until(
      () => seen.find((e) => e.event === 'seat.released' && e.payload.label === seatB),
      'seat.released event',
    );

    socket.close();
    // Re-hold for the payment below (converts into the ticketed seat).
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingB.id}/seats`)
      .set('Cookie', ownerCookie)
      .send({ seatLabel: seatB })
      .expect(200);
  });

  it('issues idempotent e-tickets and serves the PNR lookup', async () => {
    // Pay booking B → PENDING_PAYMENT, then attempt issuance too early.
    const pay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id })
      .expect(201);
    const paymentId = pay.body.id as string;

    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id })
      .expect(409); // not confirmed yet

    // PNR lookup while unpaid: booking present, no tickets.
    const prePnr = await request(app.getHttpServer())
      .get(`/api/v1/pnr/${bookingB.pnr}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(prePnr.body.booking.pnr).toBe(bookingB.pnr);
    expect(prePnr.body.tickets).toEqual([]);

    // A PNR is a locator, not a credential.
    await request(app.getHttpServer())
      .get(`/api/v1/pnr/${bookingB.pnr}`)
      .set('Cookie', otherCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/pnr/ZZZZZZ')
      .set('Cookie', ownerCookie)
      .expect(404);

    // Settle the payment → CONFIRMED → issuance allowed.
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    await until(async () => {
      const row = await prisma.booking.findUnique({ where: { id: bookingB.id } });
      return row?.status === 'CONFIRMED' ? row : null;
    }, 'booking B confirmed');

    const issued = await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id })
      .expect(201);
    expect(issued.body.alreadyIssued).toBe(false);
    expect(issued.body.tickets).toHaveLength(1);
    const ticket = issued.body.tickets[0];
    expect(ticket.ticketNumber).toMatch(/^\d{13}$/);
    expect(ticket.status).toBe('ISSUED');
    expect(ticket.seatLabel).toBe(seatB); // held seat became the assigned seat
    expect(ticket.passengerName).toBe('Real Time2');

    // Replay: same rows, never a second document number.
    const replay = await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', ownerCookie)
      .send({ bookingId: bookingB.id })
      .expect(201);
    expect(replay.body.alreadyIssued).toBe(true);
    expect(replay.body.tickets[0].ticketNumber).toBe(ticket.ticketNumber);

    // Staff may issue; unrelated passengers may not.
    const opsIssue = await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', opsCookie)
      .send({ bookingId: bookingB.id })
      .expect(201);
    expect(opsIssue.body.alreadyIssued).toBe(true);
    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', otherCookie)
      .send({ bookingId: bookingB.id })
      .expect(403);

    // The PNR view now carries the issued ticket.
    const pnr = await request(app.getHttpServer())
      .get(`/api/v1/pnr/${bookingB.pnr}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(pnr.body.tickets).toHaveLength(1);
    expect(pnr.body.tickets[0].ticketNumber).toBe(ticket.ticketNumber);
  });

  it('serves the public flight status timeline', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/flights/${flightA}/status`)
      .expect(200);
    expect(res.body.flightId).toBe(flightA);
    expect(res.body.status).toBe('SCHEDULED');
    expect(Array.isArray(res.body.events)).toBe(true);

    await request(app.getHttpServer()).get('/api/v1/flights/not-a-flight/status').expect(404);
  });

  it('replays only the events missed while offline (sinceEventId cursor)', async () => {
    // Cancel booking A while "offline" — the client never saw this event live.
    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingA.id}/cancel`)
      .set('Cookie', ownerCookie)
      .send({ reason: 'replay test' })
      .expect(200);
    expect(cancel.body.status).toBe('CANCELLED');

    const socket = connect(ownerToken);
    const seen = collect(socket);
    socket.emit('room.join', { room: `booking:${bookingA.id}`, sinceEventId: lastEventId });
    await until(
      () => seen.find((e) => e.event === 'ack' && e.payload.ok === true),
      'join ack for replay',
    );

    const replayed = await until(
      () => seen.find((e) => e.event === 'booking.updated' && e.payload.status === 'CANCELLED'),
      'replayed booking.updated CANCELLED',
    );
    expect(replayed.payload.eventId).not.toBe(lastEventId); // cursor is exclusive

    // Everything before the cursor stays gone: no payment events, and the
    // cursor itself never re-appears.
    expect(seen.some((e) => e.event === 'payment.updated')).toBe(false);
    expect(seen.some((e) => e.payload.eventId === lastEventId)).toBe(false);

    socket.close();
  });
});
