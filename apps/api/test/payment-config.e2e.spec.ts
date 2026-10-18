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

function cookieHeader(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Admin "payment plans": env-default baseline, DB overrides, masking,
 * RBAC, live-mode validation — and the core promise of the feature:
 * reconfiguring methods never disturbs in-flight payments or bookings.
 *
 * Runs against the shared dev database → cleans config rows before and
 * after so no other suite (or the running app) inherits leftover state.
 */
describe('payment plans (e2e): admin-configurable payment methods', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie = '';
  let passengerCookie = '';
  const createdBookingIds: string[] = [];
  const inventorySnapshot: Array<{
    id: string;
    seatsTotal: number;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];
  const snapshottedFlights = new Set<string>();

  const server = () => app.getHttpServer();
  const configPath = '/api/v1/admin/payment-config';

  const digits8 = (offset: number) =>
    String((Date.now() % 100_000_000) + offset)
      .padStart(8, '0')
      .slice(-8);

  async function searchFlight(date: string): Promise<string> {
    const res = await request(server())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date, adults: 1 })
      .expect(200);
    const flight = res.body.results?.[0];
    expect(flight, `seeded NBO→MBA flight for ${date} must exist`).toBeTruthy();
    return flight.flightId as string;
  }

  async function book(flightId: string): Promise<{ id: string; pnr: string }> {
    // Capture inventory once per flight so afterAll can restore it exactly —
    // deleting booking rows does not roll back the counters by itself.
    if (!snapshottedFlights.has(flightId)) {
      snapshottedFlights.add(flightId);
      const rows = await prisma.inventory.findMany({ where: { flightId } });
      inventorySnapshot.push(...rows.map((r) => ({ ...r })));
    }
    const res = await request(server())
      .post('/api/v1/bookings')
      .set('Cookie', passengerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Plan', lastName: `Taker${stamp}` }],
        contactEmail: `plan+${stamp}@flight13.example`,
      })
      .expect(201);
    createdBookingIds.push(res.body.id);
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');
    // Baseline: no overrides anywhere — every method serves env defaults.
    await prisma.paymentMethodConfig.deleteMany();
    await prisma.paymentPlanSettings.deleteMany();

    const register = await request(server())
      .post('/api/v1/auth/register')
      .send({
        email: `plan+${stamp}@flight13.example`,
        phone: `+2547${digits8(3)}`,
        password: 'Sup3rSecretPass',
        firstName: 'Plan',
        lastName: 'Taker',
        acceptTerms: true,
      })
      .expect(201);
    passengerCookie = cookieHeader(register);

    const admin = await request(server())
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@flight13.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    adminCookie = cookieHeader(admin);
  });

  afterAll(async () => {
    if (!app) return;
    if (createdBookingIds.length > 0) {
      await prisma.seatHold.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    }
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
    // Leave the shared database exactly as we found it. This spec shares the
    // dev DB with the running site, so after wiping back to env defaults we
    // restore the seeded paybill row (mirrors seed.ts's seedPaymentPlan) —
    // otherwise every test run would erase the passenger pay panel's number.
    await prisma.paymentMethodConfig.deleteMany();
    await prisma.paymentPlanSettings.deleteMany();
    await prisma.paymentMethodConfig.create({
      data: {
        provider: 'MPESA_STK',
        enabled: true,
        settings: { shortcode: '0182774255' },
      },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'plan+' } } });
    await app?.close();
  });

  // ── read path + RBAC ─────────────────────────────────────────────────────

  it('serves the effective plan: env defaults, every method, secrets masked', async () => {
    const res = await request(server()).get(configPath).set('Cookie', adminCookie).expect(200);
    expect(res.body.defaultProvider).toBe(getEnv().PAYMENT_PROVIDER_DEFAULT);
    expect(res.body.encryptionKeyConfigured).toBe(true);

    const providers = (res.body.methods as Array<{ provider: string }>).map((m) => m.provider);
    expect(providers).toEqual(['MPESA_STK', 'STRIPE', 'MOCK']);
    for (const method of res.body.methods as Array<{
      source: string;
      version: number | null;
      secrets: Record<string, { configured: boolean; masked: string | null }>;
    }>) {
      expect(method.source).toBe('ENV');
      expect(method.version).toBeNull();
      for (const status of Object.values(method.secrets)) {
        expect(status).toHaveProperty('configured');
        if (typeof status.masked === 'string') {
          expect(status.masked).not.toContain('sk_'); // shape check, never values
        }
      }
    }
  });

  it('requires ADMIN (401 anonymous, 403 authenticated non-admin)', async () => {
    await request(server()).get(configPath).expect(401);
    await request(server()).get(configPath).set('Cookie', passengerCookie).expect(403);
    await request(server())
      .patch(`${configPath}/default`)
      .set('Cookie', passengerCookie)
      .send({ defaultProvider: 'STRIPE' })
      .expect(403);
  });

  // ── write path: overrides, masking, audit ────────────────────────────────

  it('stores overrides, encrypts secrets and answers only with masks', async () => {
    const rawPasskey = 'live-passkey-abcdef-9999';
    const res = await request(server())
      .patch(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .send({
        settings: { mpesaEnv: 'sandbox', shortcode: '174379' },
        secrets: { passkey: rawPasskey },
      })
      .expect(200);

    expect(res.body.source).toBe('DATABASE');
    expect(res.body.version).toBe(1);
    expect(res.body.settings.shortcode).toBe('174379');
    expect(res.body.settings.mode).toBe(getEnv().MPESA_MODE); // untouched → env
    expect(res.body.secrets.passkey).toEqual({ configured: true, masked: '••••••••9999' });
    expect(JSON.stringify(res.body)).not.toContain(rawPasskey); // never echoed

    // At rest: envelope only — the raw value must not exist in the row.
    const row = await prisma.paymentMethodConfig.findUnique({
      where: { provider: 'MPESA_STK' },
    });
    expect(row?.secretsEnc).toMatch(/^v1\./);
    expect(row?.secretsEnc).not.toContain(rawPasskey);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment_config.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorRole).toBe('ADMIN');
  });

  it('clears a stored secret with "" so the env default applies again', async () => {
    const res = await request(server())
      .patch(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .send({ secrets: { passkey: '' } })
      .expect(200);
    expect(res.body.secrets.passkey).toEqual({ configured: false, masked: null });
    expect(res.body.source).toBe('DATABASE'); // other overrides still stand
  });

  it('rejects a live-mode save that would miss required credentials', async () => {
    const res = await request(server())
      .patch(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .send({ settings: { mode: 'live' } })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('consumerKey');

    // Nothing was persisted: effective mode is still the env default.
    const row = await prisma.paymentMethodConfig.findUnique({
      where: { provider: 'MPESA_STK' },
    });
    expect((row?.settings as { mode?: string } | null)?.mode).toBeUndefined();
  });

  it('validates the method key and the default-provider enum', async () => {
    await request(server())
      .patch(`${configPath}/NOT_A_METHOD`)
      .set('Cookie', adminCookie)
      .send({ settings: { mode: 'mock' } })
      .expect(404);
    const res = await request(server())
      .patch(`${configPath}/default`)
      .set('Cookie', adminCookie)
      .send({ defaultProvider: 'BITCOIN' })
      .expect(422);
    expect(res.body.error).toBeTruthy();
  });

  it('reverts a method to environment defaults (DELETE) with an audit trail', async () => {
    const res = await request(server())
      .delete(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.source).toBe('ENV');
    expect(res.body.version).toBeNull();
    expect(res.body.settings.shortcode).toBe(getEnv().MPESA_SHORTCODE);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment_config.revert' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  // ── the core promise: reconfiguration never disturbs ongoing activity ────

  it('switching the default method leaves in-flight payments untouched', async () => {
    const flight = await searchFlight(dateIn(10));
    const booking = await book(flight);

    // Payment created under the current default (MOCK in tests).
    const first = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', passengerCookie)
      .send({ bookingId: booking.id })
      .expect(201);
    expect(first.body.provider).toBe('MOCK');
    const firstId = first.body.id as string;

    // Admin flips the default mid-flight.
    await request(server())
      .patch(`${configPath}/default`)
      .set('Cookie', adminCookie)
      .send({ defaultProvider: 'MPESA_STK' })
      .expect(200);

    // The existing payment keeps ITS method: re-initiate + settle works.
    await request(server())
      .post(`/api/v1/payments/${firstId}/stk`)
      .set('Cookie', passengerCookie)
      .expect(200);
    const simulated = await request(server())
      .post(`/api/v1/payments/${firstId}/simulate`)
      .set('Cookie', passengerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    expect(simulated.body.status).toBe('PAID');

    const confirmed = await request(server())
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Cookie', passengerCookie)
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED'); // schedule/booking intact

    // NEW payments now take the new default.
    const flight2 = await searchFlight(dateIn(11));
    const booking2 = await book(flight2);
    const second = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', passengerCookie)
      .send({ bookingId: booking2.id })
      .expect(201);
    expect(second.body.provider).toBe('MPESA_STK');
  });

  it('blocks new payments when the active method is disabled — and recovers', async () => {
    // Default is MPESA_STK from the previous test.
    await request(server())
      .patch(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .send({ enabled: false })
      .expect(200);

    const flight = await searchFlight(dateIn(12));
    const booking = await book(flight);
    const blocked = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', passengerCookie)
      .send({ bookingId: booking.id })
      .expect(409);
    expect(blocked.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
    // The booking itself is untouched — still bookable/payable later.
    const row = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(row?.status).toBe('HELD');

    // Re-enable → the same booking can start paying immediately.
    await request(server())
      .patch(`${configPath}/MPESA_STK`)
      .set('Cookie', adminCookie)
      .send({ enabled: true })
      .expect(200);
    const paid = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', passengerCookie)
      .send({ bookingId: booking.id })
      .expect(201);
    expect(paid.body.provider).toBe('MPESA_STK');
  });
});
