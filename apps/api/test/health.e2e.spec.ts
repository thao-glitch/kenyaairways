import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Boots the real application (Prisma + Redis + global middleware) exactly as
 * `main.ts` does. Requires DATABASE_URL / REDIS_URL services to be reachable.
 */
describe('health & meta (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /healthz — liveness without touching dependencies', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('GET /readyz — postgres and redis reachable', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body.status).toBe('ok');
    const names = res.body.checks.map((c: { name: string }) => c.name);
    expect(names).toContain('postgres');
    expect(names).toContain('redis');
    for (const check of res.body.checks) expect(check.status).toBe('up');
  });

  it('GET /api/v1/meta — public configuration, no secrets leaked', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/meta').expect(200);
    expect(res.body.airline.iataCode).toBe('F13');
    expect(res.body.currency).toBe('KES');
    expect(res.body.timezone).toBe('Africa/Nairobi');
    expect(res.body.locales).toContain('sw-KE');
    expect(res.body.limits.seatHoldTtlSeconds).toBeGreaterThan(0);
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ['SECRET', 'PASSWORD', 'PASSKEY', 'CONSUMER']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('GET /api/v1/airports — seeded Kenyan network', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/airports').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((a: { code: string }) => a.code);
    for (const code of [
      'NBO',
      'WIL',
      'MBA',
      'KIS',
      'EDL',
      'MYD',
      'LAU',
      'EBB',
      'DAR',
      'JNB',
      'DXB',
      'LHR',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('sends security headers (helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('serves OpenAPI docs when enabled', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(res.text).toContain('swagger');
  });
});
