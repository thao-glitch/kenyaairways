import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger, type Logger } from '../common/logger';
import { getEnv } from '../config/env';
import { OpsService } from '../modules/ops/ops.service';
import { MANIFEST_DISPATCH_QUEUE, type ManifestDispatchJob } from '../modules/ops/queues';

/**
 * KCAA manifest dispatch worker: the HTTP call to the endpoint (or the no-op
 * hook) happens here with BullMQ retries, never on the request thread.
 */
@Injectable()
export class ManifestDispatchProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('manifest-dispatch');
  private readonly connections: Redis[] = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly ops: OpsService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(MANIFEST_DISPATCH_QUEUE, { connection: this.connection() });
    this.worker = new Worker(
      MANIFEST_DISPATCH_QUEUE,
      async (job) => {
        const { dispatchId } = job.data as ManifestDispatchJob;
        const attempt = job.attemptsMade + 1; // attemptsMade counts failures (0 on first run)
        const maxAttempts = job.opts.attempts ?? 1;
        await this.ops.processDispatch(dispatchId, attempt, attempt >= maxAttempts);
      },
      { connection: this.connection(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.log.warn('manifest dispatch job failed', { jobId: job?.id, message: err.message });
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
