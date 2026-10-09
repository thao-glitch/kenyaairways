import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomPnr } from '@flight13/shared';
import { getEnv } from '../src/config/env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RetentionService, type RetentionRunResult } from '../src/jobs/retention.service';

/**
 * M9 retention sweeps: logs past `DATA_RETENTION_LOG_DAYS` are deleted,
 * terminal bookings past `DATA_RETENTION_BOOKING_DAYS` keep their financial
 * record but lose passenger PII — and a replayed run changes nothing.
 * Windows are read from env, so the fixtures sit safely outside them.
 */
describe('retention sweeps (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;

  const DAY = 86_400_000;
  const now = new Date();
  const staleAuditIds: string[] = [];
  const staleNotifIds: string[] = [];
  const bookingIds: string[] = [];

  const oldDate = (days: number) => new Date(now.getTime() - days * DAY);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, getEnv());
    await app.init();
    prisma = app.get(PrismaService);
    retention = app.get(RetentionService);

    const env = getEnv();
    const staleLogDays = env.DATA_RETENTION_LOG_DAYS + 35;
    const staleBookingDays = env.DATA_RETENTION_BOOKING_DAYS + 45;

    // Past-window fixtures.
    const staleAudit = await prisma.auditLog.create({
      data: {
        action: 'test.stale',
        entityType: 'test',
        createdAt: oldDate(staleLogDays),
      },
    });
    staleAuditIds.push(staleAudit.id);
    const staleNotif = await prisma.notification.create({
      data: {
        channel: 'INAPP',
        templateCode: 'test.stale',
        recipient: 'stale@flight13.example',
        subject: 'stale',
        body: 'stale body with PII',
        status: 'SENT',
        createdAt: oldDate(staleLogDays),
      },
    });
    staleNotifIds.push(staleNotif.id);

    const staleBooking = await prisma.booking.create({
      data: {
        pnr: randomPnr(),
        status: 'FLOWN',
        totalMinor: 12_500,
        breakdown: [],
        contactEmail: 'juma@example.com',
        contactPhone: '+254711000111',
        createdAt: oldDate(staleBookingDays),
        passengers: {
          create: {
            seq: 1,
            firstName: 'Juma',
            lastName: 'Mwangi',
            docNumberEncrypted: 'enc-blob',
            docNumberHash: 'hash-blob',
            email: 'juma@example.com',
            dateOfBirth: new Date('1985-04-02').toISOString(),
          },
        },
      },
    });
    bookingIds.push(staleBooking.id);

    // Inside-window fixtures that must survive untouched.
    const freshAudit = await prisma.auditLog.create({
      data: { action: 'test.fresh', entityType: 'test', createdAt: oldDate(1) },
    });
    staleAuditIds.push(freshAudit.id);
    const freshNotif = await prisma.notification.create({
      data: {
        channel: 'INAPP',
        templateCode: 'test.fresh',
        recipient: 'fresh@flight13.example',
        subject: 'fresh',
        body: 'fresh body',
        status: 'SENT',
        createdAt: oldDate(1),
      },
    });
    staleNotifIds.push(freshNotif.id);
    const freshBooking = await prisma.booking.create({
      data: {
        pnr: randomPnr(),
        status: 'FLOWN',
        totalMinor: 9_900,
        breakdown: [],
        contactEmail: 'neema@example.com',
        contactPhone: '+254722000222',
        createdAt: oldDate(1),
        passengers: {
          create: { seq: 1, firstName: 'Neema', lastName: 'Kamau' },
        },
      },
    });
    bookingIds.push(freshBooking.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { id: { in: staleAuditIds } } });
      await prisma.notification.deleteMany({ where: { id: { in: staleNotifIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    }
    await app?.close();
  });

  it('deletes logs past the log window and keeps recent ones', async () => {
    const run = await retention.runOnce(now);

    expect(run.auditLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(run.notificationsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.findUnique({ where: { id: staleAuditIds[0]! } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: staleAuditIds[1]! } })).not.toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: staleNotifIds[0]! } })).toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: staleNotifIds[1]! } }),
    ).not.toBeNull();
  });

  it('strips PII from expired terminal bookings but keeps the record', async () => {
    const stale = await prisma.booking.findUnique({
      where: { id: bookingIds[0]! },
      include: { passengers: true },
    });
    expect(stale).not.toBeNull();
    expect(stale!.contactEmail).toBeNull();
    expect(stale!.contactPhone).toBeNull();
    expect(stale!.totalMinor).toBe(12_500); // money survives anonymisation
    const pax = stale!.passengers[0]!;
    expect(pax.firstName).toBe('REMOVED');
    expect(pax.lastName).toBe('REMOVED');
    expect(pax.docNumberEncrypted).toBeNull();
    expect(pax.docNumberHash).toBeNull(); // blind index is still an identifier
    expect(pax.email).toBeNull();
    expect(pax.dateOfBirth).toBeNull();

    const fresh = await prisma.booking.findUnique({
      where: { id: bookingIds[1]! },
      include: { passengers: true },
    });
    expect(fresh!.contactEmail).toBe('neema@example.com');
    expect(fresh!.passengers[0]!.firstName).toBe('Neema');
    expect(fresh!.passengers[0]!.lastName).toBe('Kamau');
  });

  it('is idempotent: a replayed run trims nothing again', async () => {
    const second: RetentionRunResult = await retention.runOnce(now);
    expect(second).toEqual({
      auditLogsDeleted: 0,
      notificationsDeleted: 0,
      bookingsAnonymised: 0,
      passengersAnonymised: 0,
    });
  });

  it('records a retention.run audit row as evidence of the sweep', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { action: 'retention.run' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('SUCCESS');
    expect(rows[0]!.metadata).toMatchObject({ bookingsAnonymised: 1 });
  });
});
