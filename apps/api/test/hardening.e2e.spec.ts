import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Env, __setEnvForTests, getEnv } from '../src/config/env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/redis/redis.module';

const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * M9 hardening: helmet + no framework fingerprinting, and the global per-IP
 * rate limit — including the paths that must stay reachable when the budget
 * is exhausted (orchestration probes, payment provider callbacks).
 */
describe('hardening (e2e)', () => {
  let app: INestApplication;
  let baseline: Env;

  const clearRateLimitKeys = async (): Promise<void> => {
    await app.get(RedisService).clearKeys('f13:rl:*');
  };

  const search = () =>
    request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(10) });

  beforeAll(async () => {
    baseline = getEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    __setEnvForTests(baseline);
    await app?.close();
  });

  it('strips framework fingerprinting and applies helmet defaults', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);

    expect(res.headers['x-powered-by']).toBeUndefined(); // express banner disabled
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toMatch(/deny|sameorigin/i);
    expect(res.headers['referrer-policy']).toBeTruthy();
  });

  it('enforces the per-IP budget with 429 RATE_LIMITED', async () => {
    await clearRateLimitKeys();
    __setEnvForTests({ ...baseline, RATE_LIMIT_MAX: 3 });
    try {
      for (let i = 0; i < 3; i += 1) {
        await search().expect(200);
      }
      const limited = await search().expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

      // Probes stay free: the orchestrator must not be throttled by real traffic.
      await request(app.getHttpServer()).get('/readyz').expect(200);
      await request(app.getHttpServer()).get('/healthz').expect(200);

      // Provider callbacks keep their own guards (secret + IP allowlist),
      // never the per-IP budget — a burst from Safaricom is legitimate.
      const cb = await request(app.getHttpServer())
        .post('/api/v1/payments/cb/not-a-real-secret/stk')
        .send({ hi: 'there' });
      expect(cb.status).not.toBe(429);
    } finally {
      __setEnvForTests(baseline);
      await clearRateLimitKeys();
    }
  });
});
