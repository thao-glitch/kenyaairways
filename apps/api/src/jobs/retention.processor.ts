import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger, type Logger } from '../common/logger';
import { getEnv } from '../config/env';
import { RetentionService } from './retention.service';

export const RETENTION_QUEUE = 'retention';

/**
 * Runs the retention sweep once a day (03:17 UTC = 06:17 EAT, off-peak).
 * The repeat pattern is fixed, so redeploys do not stack duplicate schedules;
 * the sweep itself is idempotent anyway.
 */
@Injectable()
export class RetentionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('retention-job');
  private readonly connections: Redis[] = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly retention: RetentionService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(RETENTION_QUEUE, { connection: this.connection() });
    // BullMQ v6 job scheduler (was `add(..., { repeat })`) — idempotent upsert,
    // so redeploys update the same daily slot instead of stacking.
    await this.queue.upsertJobScheduler(
      'retention-daily',
      { pattern: '17 3 * * *' },
      {
        name: 'retention-sweep',
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      },
    );
    this.worker = new Worker(
      RETENTION_QUEUE,
      async () => {
        await this.retention.runOnce();
      },
      { connection: this.connection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.log.warn('retention job failed', { jobId: job?.id, message: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((conn) => conn.quit().catch(() => undefined)));
  }

  private connection(): Redis {
    const conn = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null }); // BullMQ requirement
    conn.on('error', (err: Error) => {
      this.log.warn('redis (bullmq) connection error', { message: err.message });
    });
    this.connections.push(conn);
    return conn;
  }
}
