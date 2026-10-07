import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getEnv } from './config/env';
import { AppNestLogger } from './common/nest-logger.service';
import { createLogger } from './common/logger';

async function bootstrap(): Promise<void> {
  const env = getEnv(); // exits with a readable error list when invalid
  const log = createLogger('bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: new AppNestLogger('nest'),
    bufferLogs: false,
  });

  configureApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  log.info('api listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    docs: env.ENABLE_SWAGGER ? `${env.API_PUBLIC_URL}/api/docs` : 'disabled',
  });
}

bootstrap().catch((err) => {
  const log = createLogger('bootstrap');
  log.error('fatal bootstrap error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
