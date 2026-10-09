import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Records every response (middleware runs before guards, so 401s and 429s are
 * visible too). The label is the route *template* — `req.route.path` after the
 * router matched — never the raw path, keeping label cardinality bounded.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const routePath = (req as { route?: { path?: string } }).route?.path;
      const route =
        typeof routePath === 'string' ? `${req.baseUrl}${routePath}` || '/' : 'unmatched';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observe(req.method, route, res.statusCode, seconds);
    });
    next();
  }
}
