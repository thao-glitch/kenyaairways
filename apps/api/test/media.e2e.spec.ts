import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/redis/redis.module';
import { getEnv } from '../src/config/env';
import { MediaService } from '../src/modules/site/media.service';

const stamp = Date.now().toString(36);

function cookieHeader(res: Response): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => c.split(';')[0]);
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Appearance uploads: admins replace any site image by uploading a file
 * (served from /api/v1/media/<name>); replaced uploads are deleted so the
 * store never accumulates orphans.
 */
describe('media uploads (e2e)', () => {
  let app: INestApplication;
  let media: MediaService;
  let adminCookie = '';
  let userCookie = '';
  let server: ReturnType<typeof request>;
  const uploaded: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    media = app.get(MediaService);
    await app.get(RedisService).clearKeys('f13:rl:*');
    server = request(app.getHttpServer());

    const admin = await server
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@flight13.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    adminCookie = cookieHeader(admin).join('; ');

    const user = await server
      .post('/api/v1/auth/register')
      .send({
        email: `media+${stamp}@flight13.example`,
        password: 'Sup3rSecretPass',
        firstName: 'Media',
        lastName: `Tester${stamp}`,
        acceptTerms: true,
      })
      .expect(201);
    userCookie = cookieHeader(user).join('; ');
  });

  afterAll(async () => {
    // Restore the singleton site settings the suite mutates.
    if (adminCookie) {
      await server
        .patch('/api/v1/admin/site-settings')
        .set('Cookie', adminCookie)
        .send({ appName: 'Flight13', images: {} })
        .expect(200);
    }
    for (const url of uploaded) await media.removeByUrl(url);
    await app?.close();
  });

  it('requires authentication and the admin role', async () => {
    await server
      .post('/api/v1/admin/media')
      .attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(401);

    const forbidden = await server
      .post('/api/v1/admin/media')
      .set('Cookie', userCookie)
      .attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('serves an uploaded photograph and wires it into site settings', async () => {
    const up = await server
      .post('/api/v1/admin/media')
      .set('Cookie', adminCookie)
      .attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body.url).toMatch(/^\/api\/v1\/media\/[a-f0-9]{32}\.png$/);
    uploaded.push(up.body.url as string);

    // The upload is served back byte-for-byte with the right content type.
    const served = await server.get(up.body.url).expect(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(served.body, PNG)).toBe(0);

    // Site settings accept the media path and expose it publicly.
    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: 'Flight13', theme: 'sky', images: { hero: up.body.url } })
      .expect(200);
    const read = await server.get('/api/v1/site-settings').expect(200);
    expect(read.body.images.hero).toBe(up.body.url);

    // Clearing the override deletes the stored upload (no orphans).
    await server
      .patch('/api/v1/admin/site-settings')
      .set('Cookie', adminCookie)
      .send({ appName: 'Flight13', images: { hero: '' } })
      .expect(200);
    const cleared = await server.get('/api/v1/site-settings').expect(200);
    expect(cleared.body.images.hero).toBeUndefined();
    await server.get(up.body.url).expect(404);
  });

  it('rejects non-image payloads with the shared error envelope', async () => {
    const notAnImage = await server
      .post('/api/v1/admin/media')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('hello, not an image'), {
        filename: 'pixel.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(notAnImage.body.error.code).toBe('VALIDATION_ERROR');

    const wrongType = await server
      .post('/api/v1/admin/media')
      .set('Cookie', adminCookie)
      .attach('file', PNG, { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(422);
    expect(wrongType.body.error.code).toBe('VALIDATION_ERROR');
  });
});
