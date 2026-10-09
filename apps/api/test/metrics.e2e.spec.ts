import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { getEnv } from '../src/config/env';

/**
 * M10 observability: `/metrics` is public (scrapers hold no cookies), speaks
 * Prometheus text format, and labels are route *templates* so the registry
 * stays bounded under parameter-heavy traffic.
 */
describe('observability (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves /metrics without auth in Prometheus text format', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP http_requests_total');
    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('counts requests per route template and keeps /metrics off the API prefix', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200);
    await request(app.getHttpServer()).get('/healthz').expect(200);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    const line = res.text
      .split('\n')
      .find((l) => l.startsWith('http_requests_total{method="GET",route="/healthz",status="200"}'));
    expect(line, 'healthz counter line').toBeTruthy();
    expect(Number(line!.split(' ').pop())).toBeGreaterThanOrEqual(2);
    expect(res.text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/healthz"}',
    );

    // Root-level like the probes — the global prefix must not shadow it.
    await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
  });
});
