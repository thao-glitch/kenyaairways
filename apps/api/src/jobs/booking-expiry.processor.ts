import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env';
import { createLogger, type Logger } from '../common/logger';
import { BookingsService } from '../modules/bookings/bookings.service';

export const BOOKING_EXPIRY_QUEUE = 'booking-expiry';
const SWEEP_EVERY_MS = 30_000;

/**
 * Repeating BullMQ sweep: bookings past their TTL move to EXPIRED and their
 * inventory/seats are returned. The service method is idempotent (optimistic
 * status transition), so overlapping sweeps are safe.
 *
 * Heavy work happens here, never inside an HTTP request (see ARCHITECTURE §6).
 */
@Injectable()
export class BookingExpiryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('booking-expiry');
  private readonly connections: Redis[] = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly bookings: BookingsService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(BOOKING_EXPIRY_QUEUE, {
      connection: this.connection(),
    });
    await this.queue.upsertJobScheduler(
      'booking-expiry-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep' },
    );

    this.worker = new Worker(
      BOOKING_EXPIRY_QUEUE,
      async () => {
        const expired = await this.bookings.expireDue();
        if (expired > 0) this.log.info('swept expired bookings', { count: expired });
        return { expired };
      },
      { connection: this.connection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.log.error('expiry sweep failed', { jobId: job?.id, message: err.message });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.worker?.close(),
      this.queue?.close(),
      ...this.connections.map((c) => c.quit()),
    ]);
  }

  private connection(): Redis {
    const conn = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
    conn.on('error', (err: Error) => {
      this.log.warn('redis (bullmq) connection error', { message: err.message });
    });
    this.connections.push(conn);
    return conn;
  }
}
