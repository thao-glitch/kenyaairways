import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { getEnv, type Env } from './config/env';

export const GLOBAL_PREFIX = 'api/v1';

/**
 * Single place where the HTTP pipeline is configured — shared by `main.ts`
 * (real server) and the test harness so tests exercise production settings
 * (prefix, helmet, CORS, cookies, Swagger) exactly.
 */
export function configureApp(app: INestApplication, env: Env = getEnv()): INestApplication {
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: ['healthz', 'readyz'] });

  // Express stamps its banner on every response — no framework fingerprinting.
  (app.getHttpAdapter().getInstance() as { disable?: (setting: string) => void }).disable?.(
    'x-powered-by',
  );

  app.use(
    helmet({
      // Swagger UI is served from this origin and needs inline styles/scripts;
      // the API only emits JSON — the web app ships its own CSP (M9).
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // Provider callbacks (Daraja STK/C2B, Stripe webhooks) must verify raw
  // bytes; this path-scoped parser runs before Nest's global JSON parser
  // (body-parser skips once a body is parsed) and hands handlers a Buffer.
  app.use(`${GLOBAL_PREFIX}/payments/cb/`, express.raw({ type: 'application/json', limit: '1mb' }));

  const origins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  if (env.ENABLE_SWAGGER) {
    const config = new DocumentBuilder()
      .setTitle(`${env.AIRLINE_NAME} API`)
      .setDescription('Flight13 airline service platform — REST + OpenAPI')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: `${env.AIRLINE_NAME} API docs`,
    });
  }

  return app;
}
