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

/** Event names written to one room's Redis replay stream by RtEventsService. */
async function streamEvents(app: INestApplication, room: string): Promise<string[]> {
  const entries = (await app
    .get(RedisService)
    .raw.xrange(`rt:room:${room}`, '-', '+')) as unknown as Array<[string, string[]]>;
  return entries.flatMap(([, fields]) => {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
    return map.event ? [map.event] : [];
  });
}

/**
 * M8: ops workspace (status/gate/delay with transition rules + audit + RT),
 * the KCAA manifest view and the async `ManifestDispatcher` dispatch hook.
 */
describe('ops workspace + KCAA manifest (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let opsCookie = '';
  let paxCookie = '';
  /** Status-update playground (cancelled at the end of the suite). */
  let statusFlightId = '';
  /** Manifest + dispatch playground (paid + ticketed during the suite). */
  let manifestFlightId = '';
  /** Never-booked flight used for the empty-manifest assertion. */
  let emptyFlightId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'ops@kenyaairways.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    opsCookie = cookieHeader(login);

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `ops+${stamp}@kenyaairways.example`,
        phone: `+2547${digits8(30)}`,
        password: 'Sup3rSecretPass',
        firstName: 'Ops',
        lastName: `Checker${stamp}`,
        acceptTerms: true,
      })
      .expect(201);
    paxCookie = cookieHeader(register);

    const statusFlight = await prisma.flight.findFirst({
      where: { flightDate: dayAt(25), status: 'SCHEDULED' },
      orderBy: { scheduledDepUtc: 'asc' },
    });
    expect(statusFlight).not.toBeNull();
    statusFlightId = statusFlight!.id;

    const manifestFlight = await prisma.flight.findFirst({
      where: { flightDate: dayAt(24), status: 'SCHEDULED' },
      orderBy: { scheduledDepUtc: 'asc' },
    });
    expect(manifestFlight).not.toBeNull();
    manifestFlightId = manifestFlight!.id;

    // A flight this suite never books, so "empty manifest" survives reruns.
    const emptyFlight = await prisma.flight.findFirst({
      where: { flightDate: dayAt(27), status: 'SCHEDULED' },
      orderBy: { scheduledDepUtc: 'asc' },
    });
    expect(emptyFlight).not.toBeNull();
    emptyFlightId = emptyFlight!.id;
  });

  afterAll(async () => {
    if (app && prisma) {
      // The cancel test parks its flight in a terminal state on purpose; put
      // the demo schedule back so later suites (and the live demo) don't find
      // a permanently cancelled flight — and so the NEXT run finds a
      // SCHEDULED flight to pick again instead of burning a new one.
      if (statusFlightId) {
        await prisma.flight.update({
          where: { id: statusFlightId },
          data: { status: 'SCHEDULED', gate: null, delayMinutes: 0 },
        });
      }
      await prisma.flightStatusEvent.deleteMany({ where: { flightId: statusFlightId } });
    }
    await app?.close();
  });

  it('denies every ops route to a passenger', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/ops/flights/${statusFlightId}/status`)
      .set('Cookie', paxCookie)
      .send({ status: 'BOARDING' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/ops/manifests')
      .query({ flightId: manifestFlightId })
      .set('Cookie', paxCookie)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/ops/manifests/${manifestFlightId}/dispatch`)
      .set('Cookie', paxCookie)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/ops/dispatches')
      .query({ flightId: manifestFlightId })
      .set('Cookie', paxCookie)
      .expect(403);
  });

  it('updates status, gate and delay with timeline, audit and real-time', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/ops/flights/${statusFlightId}/status`)
      .set('Cookie', opsCookie)
      .send({
        status: 'DELAYED',
        gate: 'B7',
        delayMinutes: 45,
        message: 'Late inbound aircraft',
        source: 'MANUAL',
      })
      .expect(200);

    expect(res.body).toMatchObject({
      flightId: statusFlightId,
      status: 'DELAYED',
      gate: 'B7',
      delayMinutes: 45,
    });
    const evt = res.body.events.find(
      (e: { message: string | null }) => e.message === 'Late inbound aircraft',
    );
    expect(evt).toMatchObject({ status: 'DELAYED', gate: 'B7', source: 'MANUAL' });

    const row = await prisma.flight.findUnique({ where: { id: statusFlightId } });
    expect(row).toMatchObject({ status: 'DELAYED', gate: 'B7', delayMinutes: 45 });

    const event = await prisma.flightStatusEvent.findFirst({
      where: { flightId: statusFlightId, message: 'Late inbound aircraft' },
    });
    expect(event).not.toBeNull();
    expect(event!.source).toBe('MANUAL');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'flight.status.update', entityId: statusFlightId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorRole).toBe('OPS');
    expect(audit!.outcome).toBe('SUCCESS');

    const flightEvents = await streamEvents(app, `flight:${statusFlightId}`);
    expect(flightEvents).toContain('flight.status.changed');
    expect(flightEvents).toContain('gate.changed');
    expect(flightEvents).toContain('delay.updated');
  });

  it('cancels with an ops alert and refuses transitions out of terminal states', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/ops/flights/${statusFlightId}/status`)
      .set('Cookie', opsCookie)
      .send({ status: 'CANCELLED', message: 'Operational requirement' })
      .expect(200);

    const opsEvents = await streamEvents(app, 'ops');
    expect(opsEvents).toContain('ops.alert');

    const conflict = await request(app.getHttpServer())
      .patch(`/api/v1/ops/flights/${statusFlightId}/status`)
      .set('Cookie', opsCookie)
      .send({ status: 'BOARDING' })
      .expect(409);
    expect(JSON.stringify(conflict.body)).toContain('CANCELLED');

    const stillCancelled = await prisma.flight.findUnique({ where: { id: statusFlightId } });
    expect(stillCancelled!.status).toBe('CANCELLED');
  });

  it('404s ops lookups for unknown flights', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ops/manifests')
      .query({ flightId: 'doesnotexist12345' })
      .set('Cookie', opsCookie)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/ops/manifests/doesnotexist12345/dispatch')
      .set('Cookie', opsCookie)
      .expect(404);
  });

  it('starts with an empty manifest before any tickets exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ops/manifests')
      .query({ flightId: emptyFlightId })
      .set('Cookie', opsCookie)
      .expect(200);

    expect(res.body).toMatchObject({
      flightId: emptyFlightId,
      totals: { ticketed: 0, checkedIn: 0, seatsAssigned: 0 },
    });
    expect(res.body.passengers).toEqual([]);
    expect(typeof res.body.flightNumber).toBe('string');
  });

  it('lists the ticketed passenger after book → pay → issue', async () => {
    const book = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', paxCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId: manifestFlightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Manifest', lastName: `Pax${stamp}` }],
        contactEmail: `ops+${stamp}@kenyaairways.example`,
      })
      .expect(201);
    const bookingId = book.body.id as string;

    const pay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Cookie', paxCookie)
      .send({ bookingId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${pay.body.id}/simulate`)
      .set('Cookie', paxCookie)
      .send({ resultCode: 0 })
      .expect(200);
    await expect
      .poll(async () => (await prisma.booking.findUnique({ where: { id: bookingId } }))?.status, {
        timeout: 8_000,
      })
      .toBe('CONFIRMED');

    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', paxCookie)
      .send({ bookingId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/ops/manifests')
      .query({ flightId: manifestFlightId })
      .set('Cookie', opsCookie)
      .expect(200);

    expect(res.body.totals.ticketed).toBeGreaterThanOrEqual(1);
    const pax = res.body.passengers.find((p: { pnr: string }) => p.pnr === book.body.pnr);
    expect(pax).toMatchObject({
      firstName: 'Manifest',
      lastName: `Pax${stamp}`,
      fareClass: 'SAVER',
      checkInStatus: 'ELIGIBLE',
    });
    expect(pax.ticketNumber).toBeTruthy();
    expect(typeof pax.seq).toBe('number');
  });

  it('records a dispatched manifest attempt via the hook', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/ops/manifests/${manifestFlightId}/dispatch`)
      .set('Cookie', opsCookie)
      .expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING', flightId: manifestFlightId });

    await expect
      .poll(
        async () =>
          (await prisma.manifestDispatch.findUnique({ where: { id: res.body.id } }))?.status,
        { timeout: 10_000 },
      )
      .toMatch(/SKIPPED|DISPATCHED|FAILED/);

    const row = await prisma.manifestDispatch.findUnique({ where: { id: res.body.id } });
    expect(row!.attempts).toBeGreaterThanOrEqual(1);
    expect(row!.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.endpoint).toBe(getEnv().KCAA_MANIFEST_URL || null);
    expect(row!.status).toBe(getEnv().KCAA_MANIFEST_URL ? 'DISPATCHED' : 'SKIPPED');
    expect(row!.dispatchedAt).not.toBeNull();
    expect(row!.requestedById).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'manifest.dispatch.request', entityId: res.body.id },
    });
    expect(audit).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get('/api/v1/ops/dispatches')
      .query({ flightId: manifestFlightId })
      .set('Cookie', opsCookie)
      .expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0].id).toBe(res.body.id);
  });
});
