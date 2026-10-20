import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppError,
  type LoadFactorRowDto,
  type LoadReportDto,
  type RevenueDayDto,
  type RevenueReportDto,
} from '@kenyaairways/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { createLogger, type Logger } from '../../common/logger';

/** Africa/Nairobi is UTC+3 year-round (no DST) — safe to offset explicitly. */
const NAIROBI_OFFSET = '+03:00';
const MAX_RANGE_DAYS = 366;

export interface ReportRange {
  from?: string;
  to?: string;
}

export interface RevenueRange extends ReportRange {
  currency?: string;
}

export interface LoadRange extends ReportRange {
  origin?: string;
}

const isValidDay = (day: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime());

const dayStartUtc = (day: string): Date => new Date(`${day}T00:00:00${NAIROBI_OFFSET}`);

const addDays = (day: string, count: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

const todayNairobi = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

interface GrossRow {
  day: string;
  payments: number;
  gross: bigint;
}

interface RefundRow {
  day: string;
  refunds: number;
  refunded: bigint;
}

interface LoadRow {
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  flightDate: string;
  status: string;
  capacity: number;
  seatsSold: number;
  seatsHeld: number;
  seatsBlocked: number;
}

/**
 * Finance/ops reporting. Day buckets are **Nairobi calendar days** (finance
 * closes books locally, not UTC) — achieved with `AT TIME ZONE` in SQL rather
 * than in JS, so grouping can never drift with the app timezone.
 */
@Injectable()
export class ReportsService {
  private readonly log: Logger = createLogger('reports');

  constructor(private readonly prisma: PrismaService) {}

  async revenue(query: RevenueRange): Promise<RevenueReportDto> {
    const { from, to } = this.resolveRange(query, '30d');
    const currency = (query.currency ?? 'KES').toUpperCase();
    const fromUtc = dayStartUtc(from);
    const toUtcExclusive = dayStartUtc(addDays(to, 1));

    const gross = await this.prisma.$queryRaw<GrossRow[]>`
      SELECT to_char(p."paidAt" AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS day,
             count(*)::int AS payments,
             sum(p."amountMinor")::bigint AS gross
      FROM "Payment" p
      WHERE p.status = 'PAID'
        AND p.currency = ${currency}
        AND p."paidAt" >= ${fromUtc}
        AND p."paidAt" < ${toUtcExclusive}
      GROUP BY 1
      ORDER BY 1
    `;

    const refunds = await this.prisma.$queryRaw<RefundRow[]>`
      SELECT to_char(r."completedAt" AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS day,
             count(*)::int AS refunds,
             sum(r."amountMinor")::bigint AS refunded
      FROM "Refund" r
      WHERE r.status = 'COMPLETED'
        AND r.currency = ${currency}
        AND r."completedAt" >= ${fromUtc}
        AND r."completedAt" < ${toUtcExclusive}
      GROUP BY 1
      ORDER BY 1
    `;

    const grossByDay = new Map(gross.map((row) => [row.day, row]));
    const refundByDay = new Map(refunds.map((row) => [row.day, row]));

    const days: RevenueDayDto[] = [];
    let cursor = from;
    for (let guard = 0; cursor <= to && guard <= MAX_RANGE_DAYS; guard += 1) {
      const g = grossByDay.get(cursor);
      const r = refundByDay.get(cursor);
      const grossMinor = g ? Number(g.gross) : 0;
      const refundMinor = r ? Number(r.refunded) : 0;
      days.push({
        day: cursor,
        payments: g?.payments ?? 0,
        grossMinor,
        refunds: r?.refunds ?? 0,
        refundMinor,
        netMinor: grossMinor - refundMinor,
      });
      cursor = addDays(cursor, 1);
    }

    const totals = days.reduce(
      (acc, day) => ({
        payments: acc.payments + day.payments,
        grossMinor: acc.grossMinor + day.grossMinor,
        refunds: acc.refunds + day.refunds,
        refundMinor: acc.refundMinor + day.refundMinor,
        netMinor: acc.netMinor + day.netMinor,
      }),
      { payments: 0, grossMinor: 0, refunds: 0, refundMinor: 0, netMinor: 0 },
    );

    this.log.info('revenue report built', { from, to, currency, totals });
    return { from, to, currency, days, totals };
  }

  async load(query: LoadRange): Promise<LoadReportDto> {
    const { from, to } = this.resolveRange(query, '7d');
    const origin = query.origin?.trim().toUpperCase();

    const rows = await this.prisma.$queryRaw<LoadRow[]>`
      SELECT f.id AS "flightId",
             f."flightNumber" AS "flightNumber",
             f."originCode" AS "originCode",
             f."destinationCode" AS "destinationCode",
             to_char(f."flightDate", 'YYYY-MM-DD') AS "flightDate",
             f.status::text AS status,
             coalesce(sum(i."seatsTotal"), 0)::int AS capacity,
             coalesce(sum(i."seatsSold"), 0)::int AS "seatsSold",
             coalesce(sum(i."seatsHeld"), 0)::int AS "seatsHeld",
             coalesce(sum(i."seatsBlocked"), 0)::int AS "seatsBlocked"
      FROM "Flight" f
      LEFT JOIN "Inventory" i ON i."flightId" = f.id
      WHERE f."flightDate" >= ${from}::date
        AND f."flightDate" <= ${to}::date
        ${origin ? Prisma.sql`AND f."originCode" = ${origin}` : Prisma.empty}
      GROUP BY f.id
      ORDER BY f."flightDate", f."flightNumber"
    `;

    const detail: LoadFactorRowDto[] = rows.map((row) => ({
      flightId: row.flightId,
      flightNumber: row.flightNumber,
      originCode: row.originCode,
      destinationCode: row.destinationCode,
      flightDate: row.flightDate,
      status: row.status as LoadFactorRowDto['status'],
      capacity: row.capacity,
      seatsSold: row.seatsSold,
      seatsHeld: row.seatsHeld,
      seatsBlocked: row.seatsBlocked,
      loadFactorPct: pct(row.seatsSold, row.capacity - row.seatsBlocked),
    }));

    const totals = detail.reduce(
      (acc, row) => ({
        flights: acc.flights + 1,
        capacity: acc.capacity + row.capacity,
        seatsSold: acc.seatsSold + row.seatsSold,
        seatsBlocked: acc.seatsBlocked + row.seatsBlocked,
      }),
      { flights: 0, capacity: 0, seatsSold: 0, seatsBlocked: 0 },
    );

    return {
      from,
      to,
      rows: detail,
      totals: {
        flights: totals.flights,
        capacity: totals.capacity,
        seatsSold: totals.seatsSold,
        loadFactorPct: pct(totals.seatsSold, totals.capacity - totals.seatsBlocked),
      },
    };
  }

  /** Defaults: revenue last 30 days, load next 7 days — both Nairobi days. */
  private resolveRange(
    query: ReportRange,
    defaultSpan: '30d' | '7d',
  ): {
    from: string;
    to: string;
  } {
    const today = todayNairobi();
    const from = query.from ?? (defaultSpan === '30d' ? addDays(today, -30) : today);
    const to = query.to ?? (defaultSpan === '30d' ? today : addDays(today, 7));

    if (!isValidDay(from) || !isValidDay(to)) {
      throw new AppError('VALIDATION_ERROR', 'Dates must be valid YYYY-MM-DD days');
    }
    if (from > to) {
      throw new AppError('VALIDATION_ERROR', '`from` must not be after `to`');
    }
    const span = (dayStartUtc(to).getTime() - dayStartUtc(from).getTime()) / 86_400_000;
    if (span > MAX_RANGE_DAYS) {
      throw new AppError('VALIDATION_ERROR', `Range is capped at ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  }
}

/** Load factor against *sellable* seats (blocked seats never count). */
function pct(sold: number, sellable: number): number | null {
  if (sellable <= 0) return null;
  return Math.round((100 * sold) / sellable);
}
