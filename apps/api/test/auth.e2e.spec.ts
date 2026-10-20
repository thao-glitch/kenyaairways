import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { getEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/modules/auth/token.service';

const stamp = Date.now().toString(36);
/** 8-digit numeric suffix — Kenyan MSISDN bodies must be pure digits. */
const digits8 = (offset = 0) =>
  String((Date.now() % 100_000_000) + offset)
    .padStart(8, '0')
    .slice(-8);

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const value = res.headers['set-cookie'];
  if (Array.isArray(value)) return value as string[];
  return typeof value === 'string' ? [value] : [];
}

function cookieHeader(res: Response): string {
  const list = setCookies(res);
  return list.map((c) => c.split(';')[0]).join('; ');
}

function cookieValue(res: Response, name: string): string | undefined {
  const list = setCookies(res);
  return list.find((c) => typeof c === 'string' && c.startsWith(`${name}=`))?.split(';')[0];
}

describe('auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const password = 'Sup3rSecretPass';
  const email = `e2e+${stamp}@kenyaairways.example`;
  const phone = `+2547${digits8(1)}`;
  let sessionCookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Fixed-window counters persist in Redis between runs — start each run clean.
    await app.get(RedisService).clearKeys('f13:rl:*');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e+' } } });
    await prisma.notification.deleteMany({ where: { templateCode: { startsWith: 'otp.' } } });
    await app?.close();
  });

  it('rejects unauthenticated access to /auth/me', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('validates the registration payload (422 VALIDATION_ERROR)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'short', firstName: 'A' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('registers a passenger and starts a session via httpOnly cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        phone,
        password,
        firstName: 'Amina',
        lastName: 'Otieno',
        acceptTerms: true,
      })
      .expect(201);

    expect(res.body.user).toMatchObject({ email, role: 'PASSENGER', firstName: 'Amina' });
    expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy();
    expect(cookieValue(res, REFRESH_COOKIE)).toBeTruthy();
    sessionCookie = cookieHeader(res);

    const flags = setCookies(res).join(' ');
    expect(flags).toContain('HttpOnly');
    expect(flags).toContain('SameSite=Lax');

    const consents = await prisma.consentRecord.findMany({ where: { user: { email } } });
    expect(consents.map((c) => c.purpose).sort()).toEqual(['PRIVACY', 'TERMS']);
  });

  it('rejects duplicate registration (409)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'A', lastName: 'B', acceptTerms: true })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('requires terms acceptance', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `e2e-terms+${stamp}@kenyaairways.example`,
        password,
        firstName: 'A',
        lastName: 'B',
        acceptTerms: false,
      })
      .expect(400);
    expect(res.body.error.message).toMatch(/terms/i);
  });

  it('rejects wrong credentials without revealing whether the user exists', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: 'WrongPassword1' })
      .expect(401);
    expect(res.body.error.message).toMatch(/Incorrect/);

    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'nobody@kenyaairways.example', password: 'WrongPassword1' })
      .expect(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('logs in with password and exposes the session on /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password })
      .expect(200);
    expect(login.body.user).toMatchObject({ email, role: 'PASSENGER' });
    sessionCookie = cookieHeader(login);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200);
    expect(me.body).toMatchObject({ email, firstName: 'Amina' });
    expect(me.body).not.toHaveProperty('passwordHash');

    // The access token also works as a Bearer token (API clients, Swagger).
    const access = cookieValue(login, ACCESS_COOKIE)!.split('=')[1];
    const bearer = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${decodeURIComponent(access)}`)
      .expect(200);
    expect(bearer.body.id).toBe(me.body.id);
  });

  it('rotates the refresh token and rejects the replayed one', async () => {
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', sessionCookie)
      .expect(200);
    const rotatedCookie = cookieHeader(rotated);
    expect(rotatedCookie).toContain(`${REFRESH_COOKIE}=`);
    expect(rotatedCookie).not.toBe(sessionCookie);

    // New session still valid…
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', rotatedCookie)
      .expect(200);

    // …while replaying the consumed token revokes the family (401).
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', sessionCookie)
      .expect(401);
    expect(replay.body.error.message).toMatch(/reuse/i);

    const afterFamilyKill = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', rotatedCookie)
      .expect(401);
    expect(afterFamilyKill.body.error.code).toBe('UNAUTHENTICATED');

    // Re-establish a session for the remaining tests.
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password })
      .expect(200);
    sessionCookie = cookieHeader(login);
  });

  it('locks the account after LOGIN_MAX_ATTEMPTS failures', async () => {
    const env = getEnv();
    const lockEmail = `e2e-lock+${stamp}@kenyaairways.example`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: lockEmail, password, firstName: 'Lock', lastName: 'Test', acceptTerms: true })
      .expect(201);

    let lastStatus = 0;
    for (let attempt = 0; attempt < env.LOGIN_MAX_ATTEMPTS; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: lockEmail, password: 'Nope123456789' });
      lastStatus = res.status;
      expect([401, 423]).toContain(res.status);
      if (res.status === 423) break;
    }
    expect(lastStatus).toBe(423);

    // Even the correct password is refused while locked.
    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: lockEmail, password })
      .expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('issues and verifies an OTP through the mock SMS provider', async () => {
    const destination = `+2547${digits8(2)}`;
    const requestOtp = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ destination, purpose: 'VERIFY_PHONE' })
      .expect(202);
    expect(requestOtp.body.expiresInSeconds).toBeGreaterThan(0);

    const notification = await prisma.notification.findFirst({
      where: { recipient: destination, templateCode: 'otp.verify_phone' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    const code = notification!.body!.match(/code is (\d{6})/)![1];

    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ destination, purpose: 'VERIFY_PHONE', code: '000000' })
      .expect(401);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ destination, purpose: 'VERIFY_PHONE', code })
      .expect(200);
    expect(ok.body.verified).toBe(true);

    // Consumed codes cannot be replayed.
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ destination, purpose: 'VERIFY_PHONE', code })
      .expect(401);
  });

  it('exposes the outstanding OTP via the mock-only preview helper', async () => {
    const destination = `+2547${digits8(9)}`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ destination, purpose: 'RESET_PASSWORD' })
      .expect(202);

    // Mock mode stashes the plaintext code so a browser demo can read it.
    const preview = await request(app.getHttpServer())
      .get('/api/v1/auth/otp/preview')
      .query({ destination, purpose: 'RESET_PASSWORD' })
      .expect(200);
    expect(preview.body.code).toMatch(/^\d{6}$/);

    // It matches the notification the mock SMS "sent" and verifies cleanly.
    const notification = await prisma.notification.findFirst({
      where: { recipient: destination, templateCode: 'otp.reset_password' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification!.body).toContain(preview.body.code);

    // An unknown destination has no outstanding code → 404, not a leak.
    await request(app.getHttpServer())
      .get('/api/v1/auth/otp/preview')
      .query({ destination: `+2547${digits8(11)}`, purpose: 'RESET_PASSWORD' })
      .expect(404);
  });

  it('enforces RBAC on /admin/users', async () => {
    const env = getEnv();

    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Cookie', sessionCookie)
      .expect(403);

    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@kenyaairways.example', password: env.SEED_USER_PASSWORD })
      .expect(200);
    expect(admin.body.user.role).toBe('ADMIN');

    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/users?pageSize=5')
      .set('Cookie', cookieHeader(admin))
      .expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.total).toBeGreaterThan(0);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('passwordHash');
  });

  it('logs out and invalidates the session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(204);
    const cleared = setCookies(res).join(' ');
    expect(cleared).toContain(`${ACCESS_COOKIE}=;`);
    expect(cleared).toContain(`${REFRESH_COOKIE}=;`);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie)
      .expect(401);
  });
});
