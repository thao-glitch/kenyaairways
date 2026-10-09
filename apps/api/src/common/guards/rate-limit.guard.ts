import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { getEnv } from '../../config/env';
import { RedisService } from '../../redis/redis.module';
import { hitRateLimit } from '../rate-limit';

/**
 * Routes that must never spend the per-IP budget:
 *
 * - `healthz`/`readyz` — orchestrator probes would otherwise burn the window
 *   from the same address as real traffic;
 * - `metrics` — scrapes are frequent and internal;
 * - `payments/cb` — payment provider callbacks are validated by secret + IP
 *   allowlist at the handler and may arrive in bursts.
 *
 * Swagger sits behind middleware, not a route handler, so guards never see it;
 * Socket.IO is dispatched by engine.io before express, same story.
 */
const SKIP_PREFIXES = ['/healthz', '/readyz', '/metrics', '/api/v1/payments/cb'];

/**
 * Per-IP fixed window (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`). Runs before
 * authentication so brute-force bursts are cut before token work — Redis is
 * cheaper than a bcrypt compare, and `hitRateLimit` fails open when Redis is
 * down (availability over throttling; readyz reports the outage).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();

    const path = req.path ?? (req.url ?? '').split('?')[0];
    if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return true;
    }

    const env = getEnv();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    await hitRateLimit(this.redis, `ip:${ip}`, env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS);
    return true;
  }
}
