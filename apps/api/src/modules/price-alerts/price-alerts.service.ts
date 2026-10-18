import { Injectable } from '@nestjs/common';
import type { PriceAlertDto } from '@flight13/shared';
import { AppError } from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import type { FlightSearchDto } from '../flights/dto/flight-search.dto';
import { FlightsService } from '../flights/flights.service';

/** A drop of ≥5% below the previous low counts as a sale worth shouting about. */
const SALE_DROP_BPS = 500;

export interface CreatePriceAlertInput {
  originCode: string;
  destinationCode: string;
  cabin?: PriceAlertDto['cabin'];
  targetMinor?: number | null;
}

@Injectable()
export class PriceAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flights: FlightsService,
  ) {}

  async create(userId: string, input: CreatePriceAlertInput): Promise<PriceAlertDto> {
    const originCode = input.originCode.toUpperCase();
    const destinationCode = input.destinationCode.toUpperCase();
    if (originCode === destinationCode) {
      throw new AppError('BAD_REQUEST', 'Origin and destination must be different');
    }
    const airports = await this.prisma.airport.findMany({
      where: { code: { in: [originCode, destinationCode] } },
    });
    if (!airports.some((a) => a.code === originCode))
      throw new AppError('BAD_REQUEST', `Unknown origin airport "${originCode}"`);
    if (!airports.some((a) => a.code === destinationCode))
      throw new AppError('BAD_REQUEST', `Unknown destination airport "${destinationCode}"`);

    const existing = await this.prisma.priceAlert.findFirst({
      where: {
        userId,
        originCode,
        destinationCode,
        cabin: input.cabin ?? 'ECONOMY',
        status: 'ACTIVE',
      },
    });
    if (existing) {
      // Watching the same route twice is a client mistake, not a new alert.
      throw new AppError('CONFLICT', 'You are already tracking this route');
    }

    const alert = await this.prisma.priceAlert.create({
      data: {
        userId,
        originCode,
        destinationCode,
        cabin: input.cabin ?? 'ECONOMY',
        targetMinor: input.targetMinor ?? null,
      },
    });
    return this.toDto(alert);
  }

  async list(userId: string): Promise<PriceAlertDto[]> {
    const alerts = await this.prisma.priceAlert.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map((a) => this.toDto(a));
  }

  async cancel(userId: string, id: string): Promise<PriceAlertDto> {
    const alert = await this.prisma.priceAlert.findFirst({ where: { id, userId } });
    if (!alert) throw new AppError('NOT_FOUND', 'Price alert not found');
    if (alert.status === 'CANCELLED') return this.toDto(alert);
    const updated = await this.prisma.priceAlert.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return this.toDto(updated);
  }

  /**
   * Daily watch: sample the cheapest live total on each tracked route, keep
   * `lowestSeenMinor` fresh, and trigger + notify when either the passenger's
   * target is hit or the fare drops ≥5% below the previous low. Runs from the
   * BullMQ scheduler — safe to re-run, idempotent per alert status.
   */
  async checkOnce(): Promise<{ checked: number; triggered: number }> {
    const alerts = await this.prisma.priceAlert.findMany({ where: { status: 'ACTIVE' } });
    let triggered = 0;

    for (const alert of alerts) {
      try {
        const cheapest = await this.lowestFareOnRoute(
          alert.originCode,
          alert.destinationCode,
          alert.cabin,
        );
        if (cheapest === null) continue; // no flights in the window — try tomorrow

        const targetHit = alert.targetMinor !== null && cheapest <= alert.targetMinor;
        const saleDrop =
          alert.lowestSeenMinor !== null &&
          cheapest <= Math.round((alert.lowestSeenMinor * (10_000 - SALE_DROP_BPS)) / 10_000);

        await this.prisma.priceAlert.update({
          where: { id: alert.id },
          data: {
            lowestSeenMinor:
              alert.lowestSeenMinor === null || cheapest < alert.lowestSeenMinor
                ? cheapest
                : alert.lowestSeenMinor,
            ...(targetHit || saleDrop ? { status: 'TRIGGERED', triggeredAt: new Date() } : {}),
          },
        });

        if (targetHit || saleDrop) {
          await this.notify(alert.userId, alert.originCode, alert.destinationCode, cheapest);
          triggered += 1;
        }
      } catch {
        // One bad route must not stall the rest of the watch.
      }
    }

    return { checked: alerts.length, triggered };
  }

  private async lowestFareOnRoute(
    originCode: string,
    destinationCode: string,
    cabin: PriceAlertDto['cabin'],
  ): Promise<number | null> {
    // No date → the whole booking window (nearest first), capped by limit.
    const result = await this.flights.search({
      origin: originCode,
      destination: destinationCode,
      adults: 1,
      children: 0,
      infants: 0,
      cabin,
      limit: 200,
    } as FlightSearchDto);

    let lowest: number | null = null;
    for (const option of result.results) {
      for (const fare of option.fareOptions) {
        const total = fare.pricing.totalMinor;
        if (lowest === null || total < lowest) lowest = total;
      }
    }
    return lowest;
  }

  private async notify(
    userId: string,
    originCode: string,
    destinationCode: string,
    totalMinor: number,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const recipient = user?.email ?? user?.phone ?? 'unknown';
    const amount = (totalMinor / 100).toLocaleString('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    await this.prisma.notification.create({
      data: {
        userId,
        channel: 'INAPP',
        templateCode: 'price.alert.triggered',
        recipient,
        subject: `Fare alert: ${originCode} → ${destinationCode}`,
        body: `The lowest fare on ${originCode} → ${destinationCode} is now KSh ${amount}. Book before it moves.`,
        status: 'SENT',
        sentAt: new Date(),
        payload: { originCode, destinationCode, totalMinor, currency: 'KES' },
      },
    });
  }

  private toDto(alert: {
    id: string;
    originCode: string;
    destinationCode: string;
    cabin: PriceAlertDto['cabin'];
    targetMinor: number | null;
    lowestSeenMinor: number | null;
    status: string;
    createdAt: Date;
    triggeredAt: Date | null;
  }): PriceAlertDto {
    return {
      id: alert.id,
      originCode: alert.originCode,
      destinationCode: alert.destinationCode,
      cabin: alert.cabin,
      targetMinor: alert.targetMinor,
      lowestSeenMinor: alert.lowestSeenMinor,
      status: alert.status as PriceAlertDto['status'],
      createdAt: alert.createdAt.toISOString(),
      triggeredAt: alert.triggeredAt?.toISOString() ?? null,
    };
  }
}
