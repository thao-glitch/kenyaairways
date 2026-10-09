import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
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
  app.useWebSocketAdapter(new IoAdapter(app)); // Socket.IO for the /rt gateway
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
