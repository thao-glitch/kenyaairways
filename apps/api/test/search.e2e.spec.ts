import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('flight search (e2e)', () => {
  let app: INestApplication;
  let searchBody: {
    query: { origin: string; destination: string };
    results: Array<Record<string, any>>;
    meta: { count: number; currency: string };
  };
  let firstFlightId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('searches NBO → MBA and prices every fare option', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'nbo', destination: 'mba', date: dateIn(3), adults: 1 })
      .expect(200);

    searchBody = res.body;
    expect(searchBody.query).toMatchObject({ origin: 'NBO', destination: 'MBA' });
    expect(searchBody.meta.currency).toBe('KES');
    expect(searchBody.results.length).toBeGreaterThan(0);

    const flight = searchBody.results[0];
    firstFlightId = flight.flightId;
    expect(flight.flightNumber).toMatch(/^F13/);
    expect(flight.origin.code).toBe('NBO');
    expect(flight.destination.code).toBe('MBA');
    expect(flight.departLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/);
    expect(flight.arriveLocal).toMatch(/[+-]\d{2}:\d{2}|Z$/);
    expect(new Date(flight.departUtc).getTime()).toBeLessThan(new Date(flight.arriveUtc).getTime());
    expect(flight.durationMinutes).toBeGreaterThan(0);

    expect(flight.fareOptions.length).toBeGreaterThan(0);
    for (const option of flight.fareOptions) {
      expect(option.pricing.totalMinor).toBeGreaterThan(0);
      expect(option.pricing.totalMinor).toBe(
        option.pricing.baseFareMinor + option.pricing.taxesTotalMinor,
      );
      expect(Number.isInteger(option.pricing.totalMinor)).toBe(true);
      expect(option.seatsAvailable).toBeGreaterThanOrEqual(1);
      expect(['SAVER', 'CLASSIC', 'FLEX', 'BUSINESS']).toContain(option.fareClass.code);
    }
    // Cheapest first — the client can render options in this order.
    const totals = flight.fareOptions.map((o: any) => o.pricing.totalMinor);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
  });

  it('honours passenger counts when filtering availability', async () => {
    const big = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(3), adults: 9 })
      .expect(200);
    for (const flight of big.body.results) {
      for (const option of flight.fareOptions)
        expect(option.seatsAvailable).toBeGreaterThanOrEqual(9);
    }
    expect(big.body.results.length).toBeLessThanOrEqual(searchBody.results.length);
  });

  it('filters by cabin (BUSINESS has no seats on the E190 shuttle)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(3), cabin: 'BUSINESS' })
      .expect(200);
    expect(res.body.results).toEqual([]);
  });

  it('rejects bad search input with the shared error envelope', async () => {
    const unknown = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'XXX', destination: 'MBA', date: dateIn(3) })
      .expect(400);
    expect(unknown.body.error.code).toBe('BAD_REQUEST');
    expect(unknown.body.error.requestId).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'NBO', date: dateIn(3) })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: dateIn(-1) })
      .expect(400);

    const malformed = await request(app.getHttpServer())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date: 'not-a-date' })
      .expect(422);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns flight detail and fares for one flight', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/flights/${firstFlightId}`)
      .expect(200);
    expect(detail.body.flightId).toBe(firstFlightId);
    expect(detail.body.status).toBe('SCHEDULED');

    const fares = await request(app.getHttpServer())
      .get(`/api/v1/flights/${firstFlightId}/fares`)
      .expect(200);
    expect(Array.isArray(fares.body)).toBe(true);
    expect(fares.body.length).toBeGreaterThan(0);
    expect(fares.body[0].pricing.baseFareMinor).toBeGreaterThan(0);

    await request(app.getHttpServer()).get('/api/v1/flights/does-not-exist').expect(404);
  });

  it('lists fare classes with rules in English and Swahili', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/fare-classes').expect(200);
    const codes = res.body.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['SAVER', 'CLASSIC', 'FLEX', 'BUSINESS']));
    const saver = res.body.find((f: { code: string }) => f.code === 'SAVER');
    expect(saver.rules.length).toBeGreaterThan(0);
    expect(saver.rules[0].textEn).toBeTruthy();
    expect(saver.rules[0].textSw).toBeTruthy();
    expect(saver.baggageKg).toBeGreaterThan(0);
  });
});
