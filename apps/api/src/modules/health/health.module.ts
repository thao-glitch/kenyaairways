import { Controller, Get, HttpCode, Injectable, Module, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthDto } from '@flight13/shared';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.module';
import { RedisService } from '../../redis/redis.module';
import { createLogger } from '../../common/logger';

export const APP_VERSION = '0.1.0';

@Injectable()
export class HealthService {
  private readonly log = createLogger('health');
  private readonly startedAt = Date.now();

  liveness(): { status: 'ok'; version: string; uptimeSec: number } {
    return {
      status: 'ok',
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async readiness(): Promise<HealthDto> {
    const checks: HealthDto['checks'] = [];

    try {
      const latencyMs = await this.prisma.ping();
      checks.push({ name: 'postgres', status: 'up', latencyMs });
    } catch (err) {
      this.log.error('postgres readiness check failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      checks.push({
        name: 'postgres',
        status: 'down',
        detail: err instanceof Error ? err.message : 'unknown error',
      });
    }

    try {
      const latencyMs = await this.redis.ping();
      checks.push({ name: 'redis', status: 'up', latencyMs });
    } catch (err) {
      checks.push({
        name: 'redis',
        status: 'down',
        detail: err instanceof Error ? err.message : 'unknown error',
      });
    }

    const degraded = checks.some((c) => c.status === 'down');
    return {
      status: degraded ? 'degraded' : 'ok',
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
    };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}
}

@Controller()
@ApiTags('system')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness — process is up. Never touches dependencies. */
  @Get('healthz')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'Process is running' })
  liveness() {
    return this.health.liveness();
  }

  /** Readiness — dependencies reachable; 503 when degraded. */
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe (postgres + redis)' })
  @ApiOkResponse({ description: 'All dependencies up' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const dto = await this.health.readiness();
    if (dto.status !== 'ok') res.status(503);
    return dto;
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
