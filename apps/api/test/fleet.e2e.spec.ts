import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/redis/redis.module';

describe('fleet overview (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.get(RedisService).clearKeys('f13:rl:*');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves every aircraft type with specs, seats and registrations', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/fleet').expect(200);

    expect(res.body.types.length).toBeGreaterThanOrEqual(3);
    expect(res.body.totalAircraft).toBeGreaterThanOrEqual(res.body.types.length);

    const codes = res.body.types.map((t: { code: string }) => t.code);
    expect(codes).toContain('E190');
    expect(codes).toContain('B738');
    expect(codes).toContain('B789');

    for (const type of res.body.types) {
      expect(type.name).toBeTruthy();
      expect(type.manufacturer).toBeTruthy();
      expect(type.seats).toBeGreaterThan(0);
      expect(type.cabins.length).toBeGreaterThan(0);
      expect(type.cabins.reduce((sum: number, c: { count: number }) => sum + c.count, 0)).toBe(
        type.seats,
      );
      expect(type.aircraft.length).toBeGreaterThan(0);
      for (const ac of type.aircraft) expect(ac.registration).toMatch(/^5Y-/);
      if (type.rangeKm !== null) expect(type.rangeKm).toBeGreaterThan(1000);
    }
  });

  it('is public — no session required', async () => {
    await request(app.getHttpServer()).get('/api/v1/fleet').expect(200);
  });
});
