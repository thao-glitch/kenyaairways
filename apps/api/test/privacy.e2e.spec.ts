import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { POLICY_VERSION } from '@kenyaairways/shared';
import { getEnv } from '../src/config/env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { sha256 } from '../src/common/crypto';

/**
 * M9: Kenya DPA 2019 flows — consent ledger, access/export (full copy with a
 * verifiable digest), erasure (identity scrubbed, bookings unlinked but
 * retained under the statutory window), conflict handling and the
 * per-subject DSAR rate limit.
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

interface Subject {
  id: string;
  cookie: string;
  email: string;
  phone: string;
}

describe('data subject rights (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Subject & { bookingId: string; pnr: string };
  let carol: Subject & { bookingId: string; pnr: string };
  let frank: Subject;

  const register = async (suffix: number): Promise<Subject> => {
    const email = `dsar+${stamp}${suffix}@kenyaairways.example`;
    const phone = `+2547${digits8(60 + suffix)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        phone,
        password: 'Sup3rSecretPass',
        firstName: 'Dsa',
        lastName: `Rsubject${suffix}`,
        acceptTerms: true,
      })
      .expect(201);
    const cookie = cookieHeader(res);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    return { id: me.body.id as string, cookie, email, phone };
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

  const book = async (
    subject: Subject,
    flightId: string,
    suffix: number,
  ): Promise<{ id: string; pnr: string }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Cookie', subject.cookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Dsa', lastName: `Rider${suffix}` }],
        contactEmail: subject.email,
        contactPhone: subject.phone,
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
    const deadline = Date.now() + 8_000;
    let status = '';
    while (Date.now() < deadline) {
      status = (await prisma.booking.findUnique({ where: { id: bookingId } }))?.status ?? '';
      if (status === 'CONFIRMED') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe('CONFIRMED');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    prisma = app.get(PrismaService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    alice = { ...(await register(1)), bookingId: '', pnr: '' };
    carol = { ...(await register(2)), bookingId: '', pnr: '' };
    frank = await register(3);

    // Alice travels the whole journey — her data must appear in the export.
    const flightId = await searchFlight(dateIn(15));
    const aliceBooking = await book(alice, flightId, 1);
    alice.bookingId = aliceBooking.id;
    alice.pnr = aliceBooking.pnr;
    await payAndConfirm(alice.cookie, alice.bookingId);
    await request(app.getHttpServer())
      .post('/api/v1/ticketing/issue')
      .set('Cookie', alice.cookie)
      .send({ bookingId: alice.bookingId })
      .expect(201);

    // Carol only books — erasure keeps the record, drops the link.
    const carolBooking = await book(carol, flightId, 2);
    carol.bookingId = carolBooking.id;
    carol.pnr = carolBooking.pnr;
    await payAndConfirm(carol.cookie, carol.bookingId);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires an authenticated subject', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me/consents').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('reads the consent ledger seeded at registration', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me/consents')
      .set('Cookie', alice.cookie)
      .expect(200);
    const purposes = res.body.map((row: { purpose: string }) => row.purpose);
    expect(purposes).toContain('TERMS');
    expect(purposes).toContain('PRIVACY');
    const terms = res.body.find((row: { purpose: string }) => row.purpose === 'TERMS');
    expect(terms).toMatchObject({ granted: true, policyVersion: POLICY_VERSION });
    expect(terms.revokedAt).toBeNull();
  });

  it('appends grants and withdrawals without rewriting history', async () => {
    const before = (
      await request(app.getHttpServer())
        .get('/api/v1/me/consents')
        .set('Cookie', alice.cookie)
        .expect(200)
    ).body as unknown[];

    await request(app.getHttpServer())
      .post('/api/v1/me/consents')
      .set('Cookie', alice.cookie)
      .send({ purpose: 'MARKETING', granted: true, source: 'web' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/me/consents')
      .set('Cookie', alice.cookie)
      .send({ purpose: 'MARKETING', granted: false })
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get('/api/v1/me/consents')
        .set('Cookie', alice.cookie)
        .expect(200)
    ).body as Array<{ purpose: string; granted: boolean; revokedAt: string | null }>;
    expect(after).toHaveLength(before.length + 2);
    expect(after[0]).toMatchObject({ purpose: 'MARKETING', granted: false });
    expect(after[0].revokedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/me/consents')
      .set('Cookie', alice.cookie)
      .send({ purpose: 'TELEPATHY', granted: true })
      .expect(422);
  });

  it('exports the full copy with a verifiable digest', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/me/dsar')
      .set('Cookie', alice.cookie)
      .send({ type: 'EXPORT' })
      .expect(201);

    const dsar = res.body.request as {
      id: string;
      type: string;
      status: string;
      processedAt: string | null;
      resultKey: string | null;
    };
    const data = res.body.data as Record<string, any>;
    expect(dsar).toMatchObject({ type: 'EXPORT', status: 'COMPLETED' });
    expect(dsar.processedAt).not.toBeNull();
    expect(dsar.resultKey).toMatch(/^sha256:[0-9a-f]{64}$/);

    // The digest pins the returned bytes: resultKey = sha256 of the bundle.
    expect(`sha256:${sha256(JSON.stringify(data))}`).toBe(dsar.resultKey);

    // Own data, complete and unmasked.
    expect(data.subject).toMatchObject({ email: alice.email, phone: alice.phone });
    expect(data.subject).not.toHaveProperty('passwordHash');
    const booking = data.bookings.find((row: { pnr: string }) => row.pnr === alice.pnr);
    expect(booking, 'ticketed booking must be in the export').toBeTruthy();
    expect(booking.passengers[0].ticket.ticketNumber).toMatch(/^013\d{10}$/);
    expect(booking.payments[0].amountMinor).toBeGreaterThan(0);
    expect(data.consents.length).toBeGreaterThanOrEqual(3);
    expect(
      data.notifications.some(
        (row: { channel: string; templateCode: string }) =>
          row.channel === 'SMS' && row.templateCode === 'ticket.issued',
      ),
      'the M9 SMS mirror is the subject’s own correspondence',
    ).toBe(true);
    expect(data.auditTrail.some((row: { action: string }) => row.action === 'consent.record')).toBe(
      true,
    );

    const list = (
      await request(app.getHttpServer())
        .get('/api/v1/me/dsar')
        .set('Cookie', alice.cookie)
        .expect(200)
    ).body as Array<{ id: string; type: string; status: string }>;
    expect(list.find((row) => row.id === dsar.id)).toMatchObject({
      type: 'EXPORT',
      status: 'COMPLETED',
    });
  });

  it('refuses a second erasure while one is pending', async () => {
    const pending = await prisma.dataSubjectRequest.create({
      data: { userId: alice.id, type: 'DELETE', status: 'PENDING' },
    });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/dsar')
        .set('Cookie', alice.cookie)
        .send({ type: 'DELETE' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    } finally {
      await prisma.dataSubjectRequest.delete({ where: { id: pending.id } });
    }
  });

  it('rate limits data subject requests (10 per subject per hour)', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/me/dsar')
        .set('Cookie', frank.cookie)
        .send({ type: 'EXPORT' })
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .post('/api/v1/me/dsar')
      .set('Cookie', frank.cookie)
      .send({ type: 'EXPORT' })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('erases identity, unlinks bookings and kills the session', async () => {
    const beforeDelete = await prisma.user.findUnique({
      where: { id: carol.id },
      include: { consents: true, refreshTokens: true },
    });
    expect(beforeDelete).not.toBeNull();
    expect(beforeDelete!.consents.length).toBeGreaterThanOrEqual(2);
    expect(beforeDelete!.refreshTokens.length).toBeGreaterThan(0);

    const res = await request(app.getHttpServer())
      .post('/api/v1/me/dsar')
      .set('Cookie', carol.cookie)
      .send({ type: 'DELETE', notes: 'leaving the country' })
      .expect(201);
    expect(res.body.request).toMatchObject({ type: 'DELETE', status: 'COMPLETED' });
    expect(res.body.data).toBeUndefined();
    expect(res.body.request.notes).toContain('retained for the statutory');

    // The account is an unusable shell.
    const user = await prisma.user.findUnique({ where: { id: carol.id } });
    expect(user).toMatchObject({
      firstName: 'Deleted',
      lastName: 'Account',
      status: 'DISABLED',
      phone: null,
      passwordHash: null,
      emailVerifiedAt: null,
    });
    expect(user!.email).toMatch(/^deleted-[a-z0-9]+@deleted\.invalid$/);
    expect(user!.email).not.toBe(carol.email);

    // No identity-bearing rows remain.
    expect(await prisma.consentRecord.count({ where: { userId: carol.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: carol.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: carol.id } })).toBe(0);

    // The booking record survives — unlinked, contact-free, financially intact.
    const booking = await prisma.booking.findUnique({ where: { id: carol.bookingId } });
    expect(booking).not.toBeNull();
    expect(booking!.userId).toBeNull();
    expect(booking!.contactEmail).toBeNull();
    expect(booking!.contactPhone).toBeNull();
    expect(booking!.status).toBe('CONFIRMED');
    const pax = await prisma.bookingPassenger.findFirst({
      where: { bookingId: carol.bookingId },
    });
    expect(pax!.lastName).toBe('Rider2'); // passenger PII lives until the retention window ends

    // The session is dead: fresh login impossible, old access token rejected.
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: carol.email, password: 'Sup3rSecretPass' })
      .expect(401);
    expect(login.body.error.message).toMatch(/Incorrect/);

    const staleToken = await request(app.getHttpServer())
      .get('/api/v1/me/consents')
      .set('Cookie', carol.cookie)
      .expect(403);
    expect(staleToken.body.error.code).toBe('FORBIDDEN');
  });
});
