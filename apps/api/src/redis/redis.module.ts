import {
  Global,
  Injectable,
  Logger as NestLogger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env';
import { createLogger, type Logger } from '../common/logger';

const REDIS_PREFIX = 'f13:';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly log: Logger = createLogger('redis');
  private readonly nestLog = new NestLogger(RedisService.name);

  constructor() {
    const url = getEnv().REDIS_URL;
    // lazyConnect: the API can boot (readyz reports down) if Redis is briefly
    // unavailable; jobs/seats fail loudly rather than silently.
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      keyPrefix: REDIS_PREFIX,
    });
    this.subscriber = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      keyPrefix: REDIS_PREFIX,
    });
    for (const c of [this.client, this.subscriber]) {
      c.on('error', (err: Error) => {
        this.log.warn('redis connection error', { message: err.message });
      });
      c.on('connect', () => this.log.debug('redis connected'));
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.subscriber.connect();
      this.nestLog.log('Redis ready');
    } catch (err) {
      this.log.warn('Redis not reachable at startup — continuing degraded', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }

  get raw(): Redis {
    return this.client;
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.client.ping();
    return Date.now() - started;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.client.set(key, payload, 'EX', ttlSeconds);
    else await this.client.set(key, payload);
  }

  /** Atomic set-if-absent (seat holds, idempotency). Returns true when acquired. */
  async setNx(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /**
   * Deletes every key matching an absolute glob (e.g. `f13:rl:*`) — used by
   * test setups to reset rate-limit windows. ioredis quirk: KEYS patterns are
   * sent as-is, but DEL arguments get `keyPrefix` applied, so absolute
   * results must be stripped before deletion or every key misses.
   */
  async clearKeys(absolutePattern: string): Promise<number> {
    const keys = await this.client.keys(absolutePattern);
    if (keys.length === 0) return 0;
    const relative = keys.map((key) =>
      key.startsWith(REDIS_PREFIX) ? key.slice(REDIS_PREFIX.length) : key,
    );
    return this.client.del(...relative);
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    return this.client.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: unknown) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (_ch, message) => {
      if (_ch !== channel) return;
      try {
        handler(JSON.parse(message));
      } catch {
        handler(message);
      }
    });
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
