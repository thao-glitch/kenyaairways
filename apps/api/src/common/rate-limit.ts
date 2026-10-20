import { AppError } from '@kenyaairways/shared';
import type { RedisService } from '../redis/redis.module';

/**
 * Fixed-window counter in Redis (key prefix applied by the client).
 * Throws 429 once `max` hits are consumed inside `windowMs`.
 */
export async function hitRateLimit(
  redis: RedisService,
  key: string,
  max: number,
  windowMs: number,
): Promise<void> {
  const fullKey = `rl:${key}`;
  let count: number;
  try {
    count = await redis.raw.incr(fullKey);
    if (count === 1) await redis.raw.pexpire(fullKey, windowMs);
  } catch {
    // Redis down: fail open for availability, the readyz probe reports the outage.
    return;
  }
  if (count > max) {
    const retrySec = Math.ceil(((await ttlMs(redis, fullKey)) || windowMs) / 1000);
    throw new AppError('RATE_LIMITED', 'Too many requests — please retry shortly', {
      retryAfterSeconds: retrySec,
    });
  }
}

async function ttlMs(redis: RedisService, key: string): Promise<number | null> {
  try {
    return await redis.raw.pttl(key);
  } catch {
    return null;
  }
}
