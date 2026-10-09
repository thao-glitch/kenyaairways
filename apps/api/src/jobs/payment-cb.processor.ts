import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env';
import { createLogger, type Logger } from '../common/logger';
import { PaymentsService } from '../modules/payments/payments.service';
import {
  PAYMENT_CB_QUEUE,
  PAYMENT_RECONCILE_QUEUE,
  type PaymentCbJob,
} from '../modules/payments/queues';

/**
 * Workers for the payment pipelines:
 *
 *  - payment-cb: STK results and C2B confirmations enqueued by the fast
 *    callback endpoints. Handlers are idempotent, so at-least-once delivery
 *    (and duplicate callback HTTP posts) can never double-confirm.
 *  - payment-reconcile: repeat sweep polling PENDING attempts older than
 *    RECONCILE_STK_AFTER_SECONDS — this is how a "lost" callback resolves.
 */
@Injectable()
export class PaymentCbProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('payment-cb');
  private readonly connections: Redis[] = [];
  private cbQueue?: Queue;
  private cbWorker?: Worker;
  private reconcileQueue?: Queue;
  private reconcileWorker?: Worker;

  constructor(private readonly payments: PaymentsService) {}

  async onModuleInit(): Promise<void> {
    const env = getEnv();

    this.cbQueue = new Queue(PAYMENT_CB_QUEUE, { connection: this.connection() });
    this.cbWorker = new Worker(
      PAYMENT_CB_QUEUE,
      async (job) => {
        const data = job.data as PaymentCbJob;
        if (data.kind === 'stk') await this.payments.processStkCallback(data.mpesaTxId);
        else await this.payments.processC2B(data.c2bId);
      },
      { connection: this.connection(), concurrency: 5 },
    );
    this.cbWorker.on('failed', (job, err) => {
      this.log.error('payment cb job failed', { jobId: job?.id, message: err.message });
    });

    this.reconcileQueue = new Queue(PAYMENT_RECONCILE_QUEUE, { connection: this.connection() });
    await this.reconcileQueue.upsertJobScheduler(
      'payment-reconcile-sweep',
      { every: env.RECONCILE_STK_AFTER_SECONDS * 1000 },
      { name: 'reconcile' },
    );
    this.reconcileWorker = new Worker(
      PAYMENT_RECONCILE_QUEUE,
      async () => {
        const polled = await this.payments.reconcileOnce();
        if (polled > 0) this.log.info('reconciled payment attempts', { polled });
        return { polled };
      },
      { connection: this.connection(), concurrency: 1 },
    );
    this.reconcileWorker.on('failed', (job, err) => {
      this.log.error('reconcile sweep failed', { jobId: job?.id, message: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.cbWorker?.close(),
      this.cbQueue?.close(),
      this.reconcileWorker?.close(),
      this.reconcileQueue?.close(),
      ...this.connections.map((c) => c.quit()),
    ]);
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
