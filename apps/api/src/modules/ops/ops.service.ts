import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { FlightStatus, StatusSource } from '@prisma/client';
import {
  AppError,
  type FlightStatusDto,
  type ManifestDispatchDto,
  type ManifestDto,
  type ManifestPassengerDto,
} from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { RtEventsService } from '../../realtime/rt-events.service';
import { createLogger, maskDeep, type Logger } from '../../common/logger';
import { getEnv } from '../../config/env';
import type { BookingActor } from '../bookings/bookings.service';
import { FlightsService } from '../flights/flights.service';
import {
  MANIFEST_DISPATCHER,
  type DispatchResult,
  type ManifestDispatcher,
  type ManifestPayload,
} from './manifest-dispatcher';
import { MANIFEST_DISPATCH_QUEUE, type ManifestDispatchJob } from './queues';

/**
 * Allowed flight-state transitions for manual ops updates. Same-status updates
 * are always fine (gate/delay-only edits); LANDED and CANCELLED are terminal.
 */
const FLIGHT_STATUS_FLOW: Record<FlightStatus, FlightStatus[]> = {
  SCHEDULED: ['DELAYED', 'BOARDING', 'DEPARTED', 'CANCELLED'],
  DELAYED: ['SCHEDULED', 'BOARDING', 'DEPARTED', 'CANCELLED'],
  BOARDING: ['DELAYED', 'DEPARTED', 'CANCELLED'],
  DEPARTED: ['IN_AIR', 'LANDED'],
  IN_AIR: ['LANDED'],
  LANDED: [],
  CANCELLED: [],
};

export interface UpdateFlightStatusInput {
  status?: FlightStatus;
  gate?: string | null;
  delayMinutes?: number;
  message?: string;
  source?: StatusSource;
}

/** Bookings that no longer contribute passengers to a manifest. */
const EXCLUDED_BOOKING_STATUSES = ['CANCELLED', 'EXPIRED'] as const;

@Injectable()
export class OpsService implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('ops');
  private queue?: Queue;
  private queueConnection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rt: RtEventsService,
    private readonly flights: FlightsService,
    @Inject(MANIFEST_DISPATCHER) private readonly dispatcher: ManifestDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queueConnection = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queueConnection.on('error', (err: Error) => {
      this.log.warn('redis (manifest queue) connection error', { message: err.message });
    });
    this.queue = new Queue(MANIFEST_DISPATCH_QUEUE, { connection: this.queueConnection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.queueConnection?.quit();
  }

  // ── ops workspace: flight status ─────────────────────────────────────────

  /**
   * Applies a manual status/gate/delay update: validates the transition,
   * writes `Flight` + `FlightStatusEvent` in one transaction (the KCAA trail),
   * audits, then fans the change out over real-time.
   */
  async updateFlightStatus(
    actor: BookingActor,
    flightId: string,
    input: UpdateFlightStatusInput,
  ): Promise<FlightStatusDto> {
    const current = await this.prisma.flight.findUnique({ where: { id: flightId } });
    if (!current) throw new AppError('NOT_FOUND', 'Flight not found');

    const nextStatus = input.status ?? current.status;
    if (
      input.status &&
      input.status !== current.status &&
      !FLIGHT_STATUS_FLOW[current.status].includes(input.status)
    ) {
      throw new AppError(
        'CONFLICT',
        `Flight cannot move from ${current.status} to ${input.status}`,
      );
    }

    const gate = input.gate === '' ? null : (input.gate ?? current.gate);
    const delayMinutes = input.delayMinutes ?? current.delayMinutes;
    const statusChanged = nextStatus !== current.status;
    const gateChanged = gate !== current.gate;
    const delayChanged = delayMinutes !== current.delayMinutes;

    if (!statusChanged && !gateChanged && !delayChanged && !input.message) {
      return this.flights.flightStatus(flightId); // nothing to record
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.flight.update({
        where: { id: flightId },
        data: {
          status: nextStatus,
          gate,
          delayMinutes,
          ...(statusChanged && nextStatus === 'DEPARTED' && !current.actualDepUtc
            ? { actualDepUtc: now }
            : {}),
          ...(statusChanged && nextStatus === 'LANDED' && !current.actualArrUtc
            ? { actualArrUtc: now }
            : {}),
        },
      }),
      this.prisma.flightStatusEvent.create({
        data: {
          flightId,
          status: nextStatus,
          gate,
          delayMinutes,
          message: input.message ?? null,
          source: input.source ?? 'MANUAL',
          payload: {
            previous: {
              status: current.status,
              gate: current.gate,
              delayMinutes: current.delayMinutes,
            },
            actorId: actor.userId,
          },
        },
      }),
    ]);

    await this.audit('flight.status.update', actor, flightId, 'SUCCESS', {
      from: current.status,
      to: nextStatus,
      gate,
      delayMinutes,
    });

    // Real-time: one emit per genuinely changed facet (post-commit only).
    if (statusChanged) await this.rt.flightStatusChanged(flightId);
    if (gateChanged) await this.rt.gateChanged(flightId, gate, current.gate);
    if (delayChanged) await this.rt.delayUpdated(flightId);
    if (statusChanged && nextStatus === 'CANCELLED') {
      await this.rt.opsAlert({
        type: 'flight.cancelled',
        severity: 'critical',
        ref: current.flightNumber,
        detail: input.message ?? `${current.flightNumber} cancelled`,
      });
    }

    return this.flights.flightStatus(flightId);
  }

  // ── KCAA manifest ────────────────────────────────────────────────────────

  /** Ticketed passengers for one flight — the ops manifest view. */
  async manifest(flightId: string): Promise<ManifestDto> {
    const data = await this.manifestData(flightId);
    return {
      flightId: data.flight.id,
      flightNumber: data.flight.flightNumber,
      originCode: data.flight.originCode,
      destinationCode: data.flight.destinationCode,
      departureUtc: data.flight.scheduledDepUtc.toISOString(),
      gate: data.flight.gate,
      status: data.flight.status,
      generatedAt: new Date().toISOString(),
      totals: data.totals,
      passengers: data.passengers,
    };
  }

  /**
   * Records a dispatch attempt and enqueues the HTTP work (fast ack, the
   * endpoint call happens in the BullMQ worker with retries).
   */
  async requestDispatch(actor: BookingActor, flightId: string): Promise<ManifestDispatchDto> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      select: { id: true },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');

    const env = getEnv();
    const row = await this.prisma.manifestDispatch.create({
      data: {
        flightId,
        status: 'PENDING',
        endpoint: env.KCAA_MANIFEST_URL || null,
        operator: env.REPORTING_MANIFEST_OPERATOR || null,
        requestedById: actor.userId,
      },
    });
    const job: ManifestDispatchJob = { dispatchId: row.id };
    try {
      await this.queue?.add('manifest-dispatch', job, {
        jobId: `manifest-${row.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.manifestDispatch.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: message.slice(0, 500) },
      });
      await this.audit('manifest.dispatch.request', actor, row.id, 'FAILURE', { flightId });
      throw err;
    }
    await this.audit('manifest.dispatch.request', actor, row.id, 'SUCCESS', { flightId });
    return this.dispatchDto(row);
  }

  /** Dispatch history for one flight (ops polling view). */
  async listDispatches(flightId: string): Promise<ManifestDispatchDto[]> {
    const rows = await this.prisma.manifestDispatch.findMany({
      where: { flightId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => this.dispatchDto(row));
  }

  /**
   * Worker body: builds the manifest, hands it to the dispatcher hook and
   * settles the audit row. Idempotent — replayed jobs for a settled row no-op.
   * Failures rethrow so BullMQ retries; the last attempt settles as FAILED.
   */
  async processDispatch(dispatchId: string, attempt: number, isLast: boolean): Promise<void> {
    const row = await this.prisma.manifestDispatch.findUnique({ where: { id: dispatchId } });
    if (!row) throw new AppError('NOT_FOUND', 'Dispatch record not found');
    if (row.status !== 'PENDING') return; // replay after settle

    try {
      const payload = await this.buildPayload(row.flightId);
      const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const result: DispatchResult = await this.dispatcher.dispatch(payload);
      if (!result.ok) throw new Error(result.message);

      const status = result.responseCode === null ? 'SKIPPED' : 'DISPATCHED';
      await this.prisma.manifestDispatch.update({
        where: { id: dispatchId },
        data: {
          status,
          attempts: attempt,
          responseCode: result.responseCode,
          error: null,
          payloadDigest: digest,
          dispatchedAt: new Date(),
        },
      });
      this.log.info('manifest dispatch settled', {
        dispatchId,
        flightId: row.flightId,
        status,
        attempts: attempt,
        dispatcher: this.dispatcher.kind,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.prisma.manifestDispatch.update({
          where: { id: dispatchId },
          data: {
            status: isLast ? 'FAILED' : 'PENDING',
            attempts: attempt,
            error: message.slice(0, 500),
          },
        });
      } catch {
        // never mask the original error
      }
      if (isLast) {
        this.log.error('manifest dispatch failed permanently', {
          dispatchId,
          flightId: row.flightId,
          message,
        });
        await this.rt
          .opsAlert({
            type: 'manifest.dispatch.failed',
            severity: 'warning',
            ref: row.flightId,
            detail: message.slice(0, 200),
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Ticketed passengers + totals for one flight (shared by view + payload). */
  private async manifestData(flightId: string): Promise<{
    flight: {
      id: string;
      flightNumber: string;
      originCode: string;
      destinationCode: string;
      scheduledDepUtc: Date;
      gate: string | null;
      status: FlightStatus;
    };
    totals: ManifestDto['totals'];
    passengers: ManifestPassengerDto[];
  }> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      select: {
        id: true,
        flightNumber: true,
        originCode: true,
        destinationCode: true,
        scheduledDepUtc: true,
        gate: true,
        status: true,
      },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');

    const tickets = await this.prisma.ticket.findMany({
      where: {
        flightId,
        status: 'ISSUED',
        booking: { status: { notIn: [...EXCLUDED_BOOKING_STATUSES] } },
      },
      include: {
        booking: { select: { pnr: true } },
        bookingPassenger: { include: { checkIn: true } },
        fareClass: { select: { code: true } },
      },
    });

    const passengers: ManifestPassengerDto[] = tickets.map((t) => ({
      seq: t.bookingPassenger.seq,
      pnr: t.booking.pnr,
      ticketNumber: t.ticketNumber,
      firstName: t.bookingPassenger.firstName,
      lastName: t.bookingPassenger.lastName,
      seatLabel: t.seatLabel ?? t.bookingPassenger.checkIn?.seatLabel ?? null,
      boardingSequence: t.bookingPassenger.checkIn?.boardingSequence ?? null,
      checkInStatus: t.bookingPassenger.checkIn?.status ?? 'ELIGIBLE',
      checkedInAt: t.bookingPassenger.checkIn?.checkedInAt?.toISOString() ?? null,
      fareClass: t.fareClass.code,
      nationality: t.bookingPassenger.nationality,
      docType: t.bookingPassenger.docType,
      baggageKg: t.baggageKg,
    }));

    // Boarding order first (checked in), then seat, then name.
    passengers.sort((a, b) => {
      const seqA = a.boardingSequence ?? Number.MAX_SAFE_INTEGER;
      const seqB = b.boardingSequence ?? Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;
      return (
        (a.seatLabel ?? 'ZZZ').localeCompare(b.seatLabel ?? 'ZZZ') ||
        a.lastName.localeCompare(b.lastName)
      );
    });

    return {
      flight,
      totals: {
        ticketed: passengers.length,
        checkedIn: passengers.filter((p) => p.checkInStatus === 'CHECKED_IN').length,
        seatsAssigned: passengers.filter((p) => p.seatLabel !== null).length,
      },
      passengers,
    };
  }

  private async buildPayload(flightId: string): Promise<ManifestPayload> {
    const { flight, passengers } = await this.manifestData(flightId);
    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      originCode: flight.originCode,
      destinationCode: flight.destinationCode,
      departureUtc: flight.scheduledDepUtc.toISOString(),
      gate: flight.gate,
      operator: getEnv().REPORTING_MANIFEST_OPERATOR || '',
      generatedAt: new Date().toISOString(),
      passengers,
    };
  }

  private dispatchDto(row: {
    id: string;
    flightId: string;
    status: string;
    endpoint: string | null;
    operator: string | null;
    attempts: number;
    responseCode: number | null;
    error: string | null;
    payloadDigest: string | null;
    dispatchedAt: Date | null;
    createdAt: Date;
  }): ManifestDispatchDto {
    return {
      id: row.id,
      flightId: row.flightId,
      status: row.status as ManifestDispatchDto['status'],
      endpoint: row.endpoint,
      operator: row.operator,
      attempts: row.attempts,
      responseCode: row.responseCode,
      error: row.error,
      payloadDigest: row.payloadDigest,
      dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async audit(
    action: string,
    actor: BookingActor | null,
    entityId: string | undefined,
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: actor?.userId ?? null,
          actorRole: actor?.role ?? null,
          entityType: 'flight',
          entityId,
          outcome,
          ip: actor?.ip,
          requestId: actor?.requestId,
          metadata: metadata ? (maskDeep(metadata) as object) : undefined,
        },
      });
    } catch {
      // audit must never fail the business action
    }
  }
}
