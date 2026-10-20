import { Injectable } from '@nestjs/common';
import {
  roomForBooking,
  roomForFlight,
  roomForUser,
  type RtEventName,
  type ServerToClientEvents,
} from '@kenyaairways/shared';
import { PrismaService } from '../prisma/prisma.module';
import { RedisService } from '../redis/redis.module';
import { createLogger, type Logger } from '../common/logger';

/**
 * Where live events go — the Socket.IO gateway registers one on init.
 * `rooms` is passed as an array so a socket subscribed to several of them
 * still receives the event exactly once (socket.io dedupes room sets).
 */
export interface RtSink {
  emit<E extends RtEventName>(
    rooms: string[],
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
}

/** Per-room replay buffers (Redis streams, trimmed — best-effort recovery). */
const STREAM_MAXLEN = 100;
const streamKey = (room: string) => `rt:room:${room}`;

/**
 * Domain → real-time bridge. Services call the typed helpers *after* their
 * transaction committed; this re-reads the row (so the payload can never
 * describe state that rolled back), appends it to the room's Redis stream
 * (missed-event replay) and fans it out to every connected sink.
 *
 * Real-time must never break the business action: every failure is swallowed
 * after a warning log.
 */
@Injectable()
export class RtEventsService {
  private readonly sinks: RtSink[] = [];
  private readonly log: Logger = createLogger('rt');
  private lastMs = 0;
  private lastSeq = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  registerSink(sink: RtSink): void {
    this.sinks.push(sink);
  }

  unregisterSink(sink: RtSink): void {
    const idx = this.sinks.indexOf(sink);
    if (idx >= 0) this.sinks.splice(idx, 1);
  }

  /**
   * Monotonic `<ms>-<seq>` id — used as the Redis stream id AND the payload's
   * `eventId`, so a client that stores the last eventId it saw has a valid
   * `sinceEventId` cursor for replay.
   */
  private nextEventId(): string {
    const now = Date.now();
    if (now > this.lastMs) {
      this.lastMs = now;
      this.lastSeq = 0;
    } else {
      this.lastSeq += 1;
    }
    return `${this.lastMs}-${this.lastSeq}`;
  }

  /** Core publish: XADD to every room's stream, then fan out live. */
  async publish<E extends RtEventName>(
    event: E,
    rooms: string[],
    makePayload: (eventId: string) => Parameters<ServerToClientEvents[E]>[0],
  ): Promise<void> {
    if (rooms.length === 0) return;
    try {
      const eventId = this.nextEventId();
      const payload = makePayload(eventId);
      const serialized = JSON.stringify(payload);
      await Promise.allSettled(
        rooms.map((room) =>
          this.redis.raw.xadd(
            streamKey(room),
            'MAXLEN',
            '~',
            STREAM_MAXLEN,
            eventId,
            'event',
            event,
            'payload',
            serialized,
          ),
        ),
      );
      for (const sink of this.sinks) {
        try {
          sink.emit(rooms, event, payload);
        } catch (err) {
          this.log.warn('rt sink emit failed', {
            rooms: rooms.join(','),
            event,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      this.log.warn('rt publish failed', {
        event,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Re-emit everything after `sinceEventId` for a room (join-time recovery). */
  async replay(room: string, sinceEventId: string): Promise<void> {
    try {
      const entries = (await this.redis.raw.xrange(
        streamKey(room),
        `(${sinceEventId}`,
        '+',
        'COUNT',
        STREAM_MAXLEN,
      )) as unknown as Array<[string, string[]]>;
      for (const [, fields] of entries) {
        const map: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
        const event = map.event as RtEventName | undefined;
        if (!event || !map.payload) continue;
        const payload = JSON.parse(map.payload) as Record<string, unknown>;
        for (const sink of this.sinks) {
          try {
            sink.emit([room], event, payload as never);
          } catch {
            // one bad sink must not stop the replay
          }
        }
      }
    } catch (err) {
      this.log.warn('rt replay failed', {
        room,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── typed helpers (call AFTER the changing transaction committed) ─────────

  async bookingUpdated(bookingId: string): Promise<void> {
    try {
      const b = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          pnr: true,
          status: true,
          holdExpiresAt: true,
          expiresAt: true,
          userId: true,
        },
      });
      if (!b) return;
      const rooms = [roomForBooking(b.id)];
      if (b.userId) rooms.push(roomForUser(b.userId));
      const at = new Date().toISOString();
      await this.publish('booking.updated', rooms, (eventId) => ({
        eventId,
        bookingId: b.id,
        pnr: b.pnr,
        status: b.status,
        holdExpiresAt: (b.holdExpiresAt ?? b.expiresAt)?.toISOString() ?? null,
        at,
      }));
    } catch (err) {
      this.log.warn('booking.updated emit failed', {
        bookingId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async paymentUpdated(
    paymentId: string,
    result?: { resultCode?: number; resultMessage?: string },
  ): Promise<void> {
    try {
      const p = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          bookingId: true,
          provider: true,
          status: true,
          providerRef: true,
          booking: { select: { userId: true } },
        },
      });
      if (!p) return;
      const rooms = [roomForBooking(p.bookingId)];
      if (p.booking?.userId) rooms.push(roomForUser(p.booking.userId));
      const at = new Date().toISOString();
      await this.publish('payment.updated', rooms, (eventId) => ({
        eventId,
        paymentId: p.id,
        bookingId: p.bookingId,
        provider: p.provider,
        status: p.status,
        checkoutRequestId: p.providerRef ?? undefined,
        resultCode: result?.resultCode,
        resultMessage: result?.resultMessage,
        at,
      }));
    } catch (err) {
      this.log.warn('payment.updated emit failed', {
        paymentId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async seatChanged(
    kind: 'seat.held' | 'seat.released' | 'seat.booked',
    seat: { flightId: string; seatId: string; label: string; expiresAt?: Date | null },
  ): Promise<void> {
    const at = new Date().toISOString();
    await this.publish(kind, [roomForFlight(seat.flightId)], (eventId) => ({
      eventId,
      flightId: seat.flightId,
      seatId: seat.seatId,
      label: seat.label,
      expiresAt: seat.expiresAt?.toISOString() ?? null,
      at,
    }));
  }

  async flightStatusChanged(flightId: string): Promise<void> {
    try {
      const f = await this.prisma.flight.findUnique({
        where: { id: flightId },
        select: {
          id: true,
          flightNumber: true,
          status: true,
          scheduledDepUtc: true,
          actualDepUtc: true,
          delayMinutes: true,
        },
      });
      if (!f) return;
      const at = new Date().toISOString();
      await this.publish('flight.status.changed', [roomForFlight(f.id)], (eventId) => ({
        eventId,
        flightId: f.id,
        flightNumber: f.flightNumber,
        status: f.status,
        scheduledDepUtc: f.scheduledDepUtc.toISOString(),
        actualDepUtc: f.actualDepUtc?.toISOString() ?? null,
        delayMinutes: f.delayMinutes,
        at,
      }));
    } catch (err) {
      this.log.warn('flight.status.changed emit failed', {
        flightId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async gateChanged(
    flightId: string,
    gate: string | null,
    previousGate: string | null,
  ): Promise<void> {
    try {
      const f = await this.prisma.flight.findUnique({
        where: { id: flightId },
        select: { id: true, flightNumber: true },
      });
      if (!f) return;
      const at = new Date().toISOString();
      await this.publish('gate.changed', [roomForFlight(f.id)], (eventId) => ({
        eventId,
        flightId: f.id,
        flightNumber: f.flightNumber,
        gate,
        previousGate,
        at,
      }));
    } catch (err) {
      this.log.warn('gate.changed emit failed', {
        flightId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async delayUpdated(flightId: string): Promise<void> {
    try {
      const f = await this.prisma.flight.findUnique({
        where: { id: flightId },
        select: { id: true, flightNumber: true, scheduledDepUtc: true, delayMinutes: true },
      });
      if (!f) return;
      const at = new Date().toISOString();
      const estimated = new Date(
        f.scheduledDepUtc.getTime() + f.delayMinutes * 60_000,
      ).toISOString();
      await this.publish('delay.updated', [roomForFlight(f.id)], (eventId) => ({
        eventId,
        flightId: f.id,
        flightNumber: f.flightNumber,
        delayMinutes: f.delayMinutes,
        estimatedDepUtc: estimated,
        at,
      }));
    } catch (err) {
      this.log.warn('delay.updated emit failed', {
        flightId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Staff-room notice (OPS dashboards) — cancellations, dispatch failures, … */
  async opsAlert(alert: {
    type: string;
    severity: 'info' | 'warning' | 'critical';
    ref: string;
    detail: string;
  }): Promise<void> {
    try {
      const at = new Date().toISOString();
      await this.publish('ops.alert', ['ops'], (eventId) => ({
        eventId,
        type: alert.type,
        severity: alert.severity,
        ref: alert.ref,
        detail: alert.detail,
        at,
      }));
    } catch (err) {
      this.log.warn('ops.alert emit failed', {
        type: alert.type,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async notificationNew(notificationId: string): Promise<void> {
    try {
      const n = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: {
          id: true,
          userId: true,
          bookingId: true,
          channel: true,
          templateCode: true,
          body: true,
          subject: true,
        },
      });
      if (!n) return;
      const rooms = n.userId
        ? [roomForUser(n.userId)]
        : n.bookingId
          ? [roomForBooking(n.bookingId)]
          : [];
      if (rooms.length === 0) return;
      const at = new Date().toISOString();
      await this.publish('notification.new', rooms, (eventId) => ({
        eventId,
        notificationId: n.id,
        channel: n.channel,
        templateCode: n.templateCode,
        preview: (n.body ?? n.subject ?? '').slice(0, 160),
        at,
      }));
    } catch (err) {
      this.log.warn('notification.new emit failed', {
        notificationId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
