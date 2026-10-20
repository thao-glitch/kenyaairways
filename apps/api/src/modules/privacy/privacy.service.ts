import { Injectable } from '@nestjs/common';
import {
  AppError,
  POLICY_VERSION,
  type ConsentDto,
  type ConsentPurpose,
  type SubjectRequestDto,
  type SubjectRequestResultDto,
} from '@kenyaairways/shared';
import { maskDeep } from '../../common/logger';
import { PrismaService } from '../../prisma/prisma.module';
import { RedisService } from '../../redis/redis.module';
import { hitRateLimit } from '../../common/rate-limit';
import { getEnv } from '../../config/env';
import type { BookingActor } from '../bookings/bookings.service';
import { buildExportBundle, bundleDigest } from './export-bundle';

interface ConsentRow {
  id: string;
  purpose: string;
  policyVersion: string;
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
  source: string | null;
}

/**
 * Kenya DPA 2019 flows: consent ledger, data subject access/export (§26) and
 * erasure (§35). Erasure scrubs the account and severs booking links while the
 * booking records themselves live out their legal retention window — the
 * retention worker (jobs/retention.service.ts) finishes the job later.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listConsents(userId: string): Promise<ConsentDto[]> {
    const rows = await this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
    });
    return rows.map(toConsentDto);
  }

  /** Consent is append-only: every grant or withdrawal is a new ledger row. */
  async recordConsent(
    actor: BookingActor,
    purpose: ConsentPurpose,
    granted: boolean,
    source?: string,
  ): Promise<ConsentDto> {
    const row = await this.prisma.consentRecord.create({
      data: {
        userId: actor.userId!,
        purpose,
        policyVersion: POLICY_VERSION,
        granted,
        grantedAt: new Date(),
        revokedAt: granted ? null : new Date(),
        source: source ?? null,
      },
    });
    await this.audit('consent.record', actor, row.id, 'SUCCESS', { purpose, granted });
    return toConsentDto(row);
  }

  async listRequests(userId: string): Promise<SubjectRequestDto[]> {
    const rows = await this.prisma.dataSubjectRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map(toRequestDto);
  }

  async createRequest(
    actor: BookingActor,
    type: 'EXPORT' | 'DELETE',
    notes?: string,
  ): Promise<SubjectRequestResultDto> {
    const userId = actor.userId!;
    // One live erasure per subject — double submits must not race each other.
    if (type === 'DELETE') {
      const pending = await this.prisma.dataSubjectRequest.findFirst({
        where: { userId, type: 'DELETE', status: { in: ['PENDING', 'PROCESSING'] } },
      });
      if (pending) {
        throw new AppError('CONFLICT', 'An erasure request is already in progress');
      }
    }
    await hitRateLimit(this.redis, `dsar:${userId}`, 10, 3_600_000);

    const request = await this.prisma.dataSubjectRequest.create({
      data: { userId, type, notes: notes?.slice(0, 1_000) ?? null },
    });

    try {
      if (type === 'EXPORT') {
        const data = await buildExportBundle(this.prisma, userId);
        const resultKey = bundleDigest(data);
        const updated = await this.prisma.dataSubjectRequest.update({
          where: { id: request.id },
          data: { status: 'COMPLETED', processedAt: new Date(), resultKey },
        });
        await this.audit('dsar.export', actor, request.id, 'SUCCESS', { resultKey });
        return { request: toRequestDto(updated), data };
      }

      const summary = await this.erase(actor, request.id);
      const updated = await this.prisma.dataSubjectRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      await this.audit('dsar.delete', actor, request.id, 'SUCCESS', { summary });
      return { request: toRequestDto(updated) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.dataSubjectRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', processedAt: new Date(), notes: message.slice(0, 500) },
      });
      await this.audit(`dsar.${type.toLowerCase()}`, actor, request.id, 'FAILURE', { message });
      throw err;
    }
  }

  /**
   * Erasure in one transaction: every identity-bearing row either goes or is
   * severed, and the account itself becomes an unusable shell. Booking records
   * stay (aviation/financial retention) but no longer point at a person; the
   * retention worker anonymises passenger PII inside them at the end of the
   * `DATA_RETENTION_BOOKING_DAYS` window.
   */
  private async erase(actor: BookingActor, requestId: string): Promise<Record<string, number>> {
    const userId = actor.userId!;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND', 'Account not found');

    const destinations = [user.email, user.phone].filter((value): value is string =>
      Boolean(value),
    );

    return this.prisma.$transaction(async (tx) => {
      // Identity + session material.
      await tx.otpCode.deleteMany({ where: { destination: { in: destinations } } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.consentRecord.deleteMany({ where: { userId } });
      await tx.passengerProfile.deleteMany({ where: { userId } });
      // Bodies and recipients are PII.
      await tx.notification.deleteMany({ where: { userId } });
      // Records survive, links do not.
      const seatHolds = await tx.seatHold.updateMany({ where: { userId }, data: { userId: null } });
      const bookings = await tx.booking.updateMany({
        where: { userId },
        data: { userId: null, contactEmail: null, contactPhone: null },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId.slice(-8)}@deleted.invalid`,
          phone: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          passwordHash: null,
          firstName: 'Deleted',
          lastName: 'Account',
          status: 'DISABLED',
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.dataSubjectRequest.update({
        where: { id: requestId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          notes:
            'PII erased: sessions revoked, consents removed, profile deleted, bookings ' +
            'unlinked. Booking records themselves are retained for the statutory ' +
            `window (DATA_RETENTION_BOOKING_DAYS=${getEnv().DATA_RETENTION_BOOKING_DAYS}).`,
        },
      });

      return {
        bookings: bookings.count,
        seatHolds: seatHolds.count,
        otpTargets: destinations.length,
      };
    });
  }

  private async audit(
    action: string,
    actor: BookingActor,
    entityId: string | undefined,
    outcome: 'SUCCESS' | 'FAILURE',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'data_request',
          entityId,
          outcome,
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: metadata ? (maskDeep(metadata) as object) : undefined,
        },
      });
    } catch {
      // audit must never fail the subject's rights flow
    }
  }
}

function toConsentDto(row: ConsentRow): ConsentDto {
  return {
    id: row.id,
    purpose: row.purpose as ConsentDto['purpose'],
    policyVersion: row.policyVersion,
    granted: row.granted,
    grantedAt: row.grantedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    source: row.source,
  };
}

function toRequestDto(row: {
  id: string;
  type: string;
  status: string;
  requestedAt: Date;
  processedAt: Date | null;
  resultKey: string | null;
  notes: string | null;
}): SubjectRequestDto {
  return {
    id: row.id,
    type: row.type as SubjectRequestDto['type'],
    status: row.status as SubjectRequestDto['status'],
    requestedAt: row.requestedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    resultKey: row.resultKey,
    notes: row.notes,
  };
}
