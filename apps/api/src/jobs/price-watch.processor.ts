import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger, type Logger } from '../common/logger';
import { getEnv } from '../config/env';
import { PriceAlertsService } from '../modules/price-alerts/price-alerts.service';

export const PRICE_WATCH_QUEUE = 'price-watch';

/**
 * Samples tracked-route fares once a day (06:23 UTC = 09:23 EAT) and notifies
 * passengers whose target got hit or whose route dropped ≥5%. The fixed repeat
 * pattern is upserted, so redeploys never stack duplicate schedules.
 */
@Injectable()
export class PriceWatchProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('price-watch-job');
  private readonly connections: Redis[] = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly alerts: PriceAlertsService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(PRICE_WATCH_QUEUE, { connection: this.connection() });
    await this.queue.upsertJobScheduler('price-watch-daily', { pattern: '23 6 * * *' });
    this.worker = new Worker(
      PRICE_WATCH_QUEUE,
      async () => {
        const result = await this.alerts.checkOnce();
        this.log.info('price watch complete', result);
      },
      { connection: this.connection() },
    );
    this.worker.on('failed', (job, err) => {
      this.log.error('price watch failed', { jobId: job?.id, error: err.message });
    });
    this.log.info('price watch scheduled', { pattern: '23 6 * * *' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    for (const conn of this.connections) conn.disconnect();
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
