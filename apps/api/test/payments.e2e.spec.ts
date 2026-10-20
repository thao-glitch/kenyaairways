import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.module';
import { RedisService } from '../src/redis/redis.module';
import { getEnv } from '../src/config/env';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { BookingsService } from '../src/modules/bookings/bookings.service';

const stamp = Date.now().toString(36);
const CB_SECRET = getEnv().MPESA_CALLBACK_SECRET;
const CB = (sub: string) => `/api/v1/payments/cb/${CB_SECRET}/${sub}`;
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function cookieHeader(res: Response): string {
  const list = Array.isArray(res.headers['set-cookie'])
    ? (res.headers['set-cookie'] as string[])
    : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('payments (e2e): STK, callbacks, C2B, refunds, reconciliation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let bookingsSvc: BookingsService;
  let ownerCookie = '';
  let otherCookie = '';
  let financeCookie = '';
  const financePhone = '+254720000004';
  let flightA = ''; // STK flows
  let flightB = ''; // C2B flows
  let flightC = ''; // refunds
  let flightD = ''; // reconciliation + access
  let economySeat = '7C';
  let receiptSeq = 0;
  let transSeq = 0;
  let bookSeq = 0;

  const createdBookingIds: string[] = [];
  const createdTransIds: string[] = [];
  const inventorySnapshot: Array<{
    id: string;
    seatsTotal: number;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }> = [];

  const server = () => app.getHttpServer();

  async function waitFor<T>(
    label: string,
    fn: () => Promise<T | null | undefined | false>,
  ): Promise<T> {
    const deadline = Date.now() + 15_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const value = await fn();
        if (value) return value as T;
      } catch (err) {
        lastErr = err;
      }
      await sleep(120);
    }
    throw new Error(`timeout waiting for ${label}${lastErr ? ` (last: ${String(lastErr)})` : ''}`);
  }

  async function searchFlight(date: string): Promise<string> {
    const res = await request(server())
      .get('/api/v1/flights/search')
      .query({ origin: 'NBO', destination: 'MBA', date, adults: 1 })
      .expect(200);
    const flight = res.body.results?.[0];
    expect(flight, `seeded NBO→MBA flight for ${date} must exist`).toBeTruthy();
    return flight.flightId as string;
  }

  async function book(
    flightId: string,
    opts: { seat?: string } = {},
  ): Promise<{
    id: string;
    pnr: string;
    totalMinor: number;
  }> {
    bookSeq += 1;
    const res = await request(server())
      .post('/api/v1/bookings')
      .set('Cookie', ownerCookie)
      .send({
        tripType: 'ONE_WAY',
        segments: [{ flightId, fareClassCode: 'SAVER' }],
        passengers: [{ type: 'ADULT', firstName: 'Pay', lastName: `Mentest${bookSeq}` }],
        contactEmail: `pay+${stamp}@kenyaairways.example`,
        ...(opts.seat ? { seats: [{ segmentSeq: 0, seatLabel: opts.seat }] } : {}),
      })
      .expect(201);
    createdBookingIds.push(res.body.id);
    return res.body;
  }

  async function pay(bookingId: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const res = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId, ...(idempotencyKey ? { idempotencyKey } : {}) })
      .expect(201);
    return res.body;
  }

  function mkStk(
    checkoutRequestId: string,
    opts: { code?: number; amountMajor?: number } = {},
  ): Record<string, unknown> {
    const code = opts.code ?? 0;
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: `MRQ-${stamp}`,
          CheckoutRequestID: checkoutRequestId,
          ResultCode: code,
          ResultDesc: `Result code ${code}`,
          ...(code === 0
            ? {
                CallbackMetadata: {
                  Item: [
                    { Name: 'Amount', Value: opts.amountMajor ?? 100 },
                    { Name: 'MpesaReceiptNumber', Value: `RCT${stamp}${receiptSeq++}` },
                    { Name: 'TransactionDate', Value: 20_260_109_104_530 },
                    { Name: 'PhoneNumber', Value: 254_712_345_678 },
                  ],
                },
              }
            : {}),
        },
      },
    };
  }

  async function latestTx(paymentId: string) {
    return prisma.mpesaTransaction.findFirst({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function bookingStatus(bookingId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    return res.body.status as string;
  }

  async function paymentRow(paymentId: string) {
    return waitFor('payment terminal state', async () => {
      const row = await prisma.payment.findUnique({ where: { id: paymentId } });
      return row ?? null;
    });
  }

  async function snap(flightId: string) {
    const rows = await prisma.inventory.findMany({ where: { flightId } });
    return {
      held: rows.reduce((s, r) => s + r.seatsHeld, 0),
      sold: rows.reduce((s, r) => s + r.seatsSold, 0),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    payments = app.get(PaymentsService);
    bookingsSvc = app.get(BookingsService);

    await app.get(RedisService).clearKeys('f13:rl:*');

    const register = async (email: string, phone: string, first: string, last: string) => {
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({
          email,
          phone,
          password: 'Sup3rSecretPass',
          firstName: first,
          lastName: last,
          acceptTerms: true,
        })
        .expect(201);
      return cookieHeader(res);
    };
    const digits8 = (offset: number) =>
      String((Date.now() % 100_000_000) + offset)
        .padStart(8, '0')
        .slice(-8);
    ownerCookie = await register(
      `pay+${stamp}@kenyaairways.example`,
      `+2547${digits8(1)}`,
      'Pay',
      'Owner',
    );
    otherCookie = await register(
      `pay2+${stamp}@kenyaairways.example`,
      `+2547${digits8(2)}`,
      'Pay',
      'Other',
    );
    const fin = await request(server())
      .post('/api/v1/auth/login')
      .send({ identifier: 'finance@kenyaairways.example', password: getEnv().SEED_USER_PASSWORD })
      .expect(200);
    financeCookie = cookieHeader(fin);

    flightA = await searchFlight(dateIn(6));
    flightB = await searchFlight(dateIn(7));
    flightC = await searchFlight(dateIn(8));
    flightD = await searchFlight(dateIn(9));

    // A real seat on flightA for the conversion assertions.
    const full = await prisma.flight.findUnique({
      where: { id: flightA },
      include: { aircraft: { include: { aircraftType: { include: { seatMap: true } } } } },
    });
    const seat = await prisma.seat.findFirst({
      where: {
        seatMapId: full!.aircraft!.aircraftType.seatMap!.id,
        active: true,
        blocked: false,
        cabin: 'ECONOMY',
      },
      orderBy: { row: 'asc' },
    });
    economySeat = seat!.label;

    // Start from a clean slate on our flights (crashed runs leave holds).
    await prisma.seatHold.deleteMany({
      where: { flightId: { in: [flightA, flightB, flightC, flightD] } },
    });
    const rows = await prisma.inventory.findMany({
      where: { flightId: { in: [flightA, flightB, flightC, flightD] } },
    });
    inventorySnapshot.push(...rows.map((r) => ({ ...r })));
  });

  afterAll(async () => {
    if (!app) return;
    await prisma.notification.deleteMany({
      where: { recipient: financePhone, templateCode: 'otp.refund' },
    });
    await prisma.mpesaC2BPayment.deleteMany({ where: { transId: { in: createdTransIds } } });
    await prisma.seatHold.deleteMany({
      where: {
        OR: [
          { bookingId: { in: createdBookingIds } },
          { flightId: { in: [flightA, flightB, flightC, flightD] } },
        ],
      },
    });
    await prisma.booking.deleteMany({
      where: {
        OR: [{ id: { in: createdBookingIds } }, { contactEmail: { contains: `pay+${stamp}` } }],
      },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: `pay+${stamp}` } } });
    for (const row of inventorySnapshot) {
      await prisma.inventory.update({
        where: { id: row.id },
        data: {
          seatsTotal: row.seatsTotal,
          seatsHeld: row.seatsHeld,
          seatsSold: row.seatsSold,
          seatsBlocked: row.seatsBlocked,
        },
      });
    }
    await app.close();
  });

  // ── STK push ──────────────────────────────────────────────────────────────

  it('creates an idempotent payment and moves the booking to PENDING_PAYMENT', async () => {
    const booking = await book(flightA);
    const key = `idem-${stamp}-1`;

    const res = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: booking.id, idempotencyKey: key })
      .expect(201);
    expect(res.body.status).toBe('REQUIRES_ACTION');
    expect(res.body.providerRef).toMatch(/^MOCKCHK_/);
    expect(res.body.amountMinor).toBe(booking.totalMinor);

    // replay with the same key → same payment, never a second attempt
    const replay = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: booking.id, idempotencyKey: key })
      .expect(201);
    expect(replay.body.id).toBe(res.body.id);

    expect(await bookingStatus(booking.id)).toBe('PENDING_PAYMENT');

    const tx = await prisma.mpesaTransaction.findFirst({ where: { paymentId: res.body.id } });
    expect(tx).toBeTruthy();
    expect(tx!.accountReference).toBe(booking.pnr);
    expect(tx!.accountReference.length).toBeLessThanOrEqual(12);
    expect(tx!.amountExpectedMinor).toBe(booking.totalMinor);
    expect(tx!.status).toBe('PENDING');

    // same key, different booking → conflict
    const other = await book(flightA);
    await request(server())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: other.id, idempotencyKey: key })
      .expect(409);
  });

  it('confirms on STK success: payment PAID, booking CONFIRMED, seat converted', async () => {
    const before = await snap(flightA);
    const booking = await book(flightA, { seat: economySeat });
    const payment = await pay(booking.id);

    const res = await request(server())
      .post(`/api/v1/payments/${payment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    expect(res.body.status).toBe('PAID');
    expect(res.body.paidAt).toBeTruthy();

    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');

    const after = await snap(flightA);
    expect(after.sold).toBe(before.sold + 1); // exactly one seat sold
    expect(after.held).toBe(before.held); // hold converted, not leaked

    const hold = await prisma.seatHold.findFirst({ where: { bookingId: booking.id } });
    expect(hold?.status).toBe('CONVERTED');
    expect(hold?.activeKey).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment.paid', entityId: (await latestTx(payment.id as string))!.id },
    });
    expect(audit).toBeTruthy();
  });

  it('never double-confirms when the same callback is delivered three times', async () => {
    const before = await snap(flightA);
    const booking = await book(flightA);
    const payment = await pay(booking.id);
    const tx = await latestTx(payment.id as string);
    const payload = mkStk(tx!.checkoutRequestId, { amountMajor: tx!.amountMinor / 100 });

    // three parallel deliveries of the identical callback
    const acks = await Promise.all(
      [1, 2, 3].map(() =>
        request(server()).post(CB('stk')).set('content-type', 'application/json').send(payload),
      ),
    );
    for (const ack of acks) {
      expect(ack.status).toBe(200);
      expect(ack.body.ResultCode).toBe(0);
    }

    await waitFor('booking CONFIRMED via callback', () =>
      bookingStatus(booking.id).then((s) => (s === 'CONFIRMED' ? true : null)),
    );
    await sleep(600); // let any duplicate job finish its no-op pass

    const after = await snap(flightA);
    expect(after.sold).toBe(before.sold + 1); // NOT +3
    expect(after.held).toBe(before.held);

    const finalPayment = await paymentRow(payment.id as string);
    expect(finalPayment.status).toBe('PAID');

    const finalTx = await prisma.mpesaTransaction.findFirst({
      where: { checkoutRequestId: tx!.checkoutRequestId },
    });
    expect(finalTx?.status).toBe('SUCCESS');
    expect(finalTx?.resultCode).toBe(0);
    expect(finalTx?.mpesaReceiptNumber).toBeTruthy();

    // exactly one "paid" audit despite three deliveries (entityId = mpesa tx)
    const paidAudits = await prisma.auditLog.count({
      where: { action: 'payment.paid', entityId: tx!.id },
    });
    expect(paidAudits).toBe(1);
  });

  it('maps failure result codes and allows re-initiating the STK push', async () => {
    const booking = await book(flightA);
    const payment = await pay(booking.id);

    // 1 = insufficient funds
    const res = await request(server())
      .post(`/api/v1/payments/${payment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 1 })
      .expect(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failureCode).toBe('MPESA_1');
    expect(res.body.failureMessage).toMatch(/insufficient/i);
    expect(await bookingStatus(booking.id)).toBe('PENDING_PAYMENT'); // retryable

    // re-initiate → new provider attempt
    const firstTx = await latestTx(payment.id as string);
    const again = await request(server())
      .post(`/api/v1/payments/${payment.id}/stk`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(again.body.status).toBe('REQUIRES_ACTION');
    expect(again.body.providerRef).not.toBe(firstTx?.checkoutRequestId);
    const secondTx = await latestTx(payment.id as string);
    expect(secondTx?.id).not.toBe(firstTx?.id);

    // 1032 (cancelled by user) arrives on the callback path
    await request(server())
      .post(CB('stk'))
      .set('content-type', 'application/json')
      .send(mkStk(secondTx!.checkoutRequestId, { code: 1032 }))
      .expect(200);
    await waitFor('cancelled attempt', async () => {
      const row = await prisma.mpesaTransaction.findUnique({ where: { id: secondTx!.id } });
      return row?.status === 'CANCELLED' ? row : null;
    });
    const failed = await paymentRow(payment.id as string);
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('MPESA_1032');
    expect(await bookingStatus(booking.id)).toBe('PENDING_PAYMENT');
    const first = await prisma.mpesaTransaction.findUnique({ where: { id: firstTx!.id } });
    expect(first?.status).toBe('FAILED'); // history preserved
  });

  it('maps 1037 → TIMEOUT and 2001 → wrong PIN', async () => {
    for (const [code, expectedTx] of [
      [1037, 'TIMEOUT'],
      [2001, 'FAILED'],
    ] as const) {
      const booking = await book(flightA);
      const payment = await pay(booking.id);
      const res = await request(server())
        .post(`/api/v1/payments/${payment.id}/simulate`)
        .set('Cookie', ownerCookie)
        .send({ resultCode: code })
        .expect(200);
      expect(res.body.failureCode).toBe(`MPESA_${code}`);
      const tx = await latestTx(payment.id as string);
      expect(tx?.status).toBe(expectedTx);
      expect(await bookingStatus(booking.id)).toBe('PENDING_PAYMENT');
    }
  });

  it('hardens the callback endpoint: secret, schema, unknown checkout', async () => {
    const booking = await book(flightA);
    const payment = await pay(booking.id);
    const tx = await latestTx(payment.id as string);

    // wrong secret → 404 (indistinguishable from a missing route)
    await request(server())
      .post('/api/v1/payments/cb/deadbeef/stk')
      .set('content-type', 'application/json')
      .send(mkStk(tx!.checkoutRequestId))
      .expect(404);

    // malformed payload → 422, nothing processed
    await request(server()).post(CB('stk')).send({ foo: 1 }).expect(422);
    const untouched = await paymentRow(payment.id as string);
    expect(untouched.status).toBe('REQUIRES_ACTION');

    // unknown CheckoutRequestID → still acked (no retry storms), no state change
    const ack = await request(server())
      .post(CB('stk'))
      .set('content-type', 'application/json')
      .send(mkStk(`ws_CO_UNKNOWN_${stamp}`))
      .expect(200);
    expect(ack.body.note).toBe('unknown_checkout');
  });

  it('refuses to confirm when the callback amount does not match', async () => {
    const booking = await book(flightA);
    const payment = await pay(booking.id);
    const tx = await latestTx(payment.id as string);

    await request(server())
      .post(CB('stk'))
      .set('content-type', 'application/json')
      .send(mkStk(tx!.checkoutRequestId, { amountMajor: tx!.amountMinor / 100 - 1 }))
      .expect(200);

    await waitFor('amount mismatch recorded', async () => {
      const row = await prisma.payment.findUnique({ where: { id: payment.id as string } });
      return row?.failureCode === 'AMOUNT_MISMATCH' ? row : null;
    });
    const final = await paymentRow(payment.id as string);
    expect(final.status).toBe('FAILED');
    expect(await bookingStatus(booking.id)).toBe('PENDING_PAYMENT');
    const finalTx = await prisma.mpesaTransaction.findUnique({ where: { id: tx!.id } });
    expect(finalTx?.status).toBe('FAILED');
  });

  it('records money that arrives after expiry but cannot confirm the booking', async () => {
    const before = await snap(flightA);
    const booking = await book(flightA);
    const payment = await pay(booking.id);

    // TTL passes → the real sweeper expires the booking and returns the seat
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const swept = await bookingsSvc.expireDue();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await bookingStatus(booking.id)).toBe('EXPIRED');
    expect(await snap(flightA)).toEqual(before); // held seat returned

    const res = await request(server())
      .post(`/api/v1/payments/${payment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    expect(res.body.status).toBe('PAID');
    expect(res.body.failureMessage).toMatch(/manual resolution/i);

    const finalBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(finalBooking?.status).toBe('EXPIRED'); // never silently re-confirmed

    const orphanAudit = await prisma.auditLog.findFirst({
      where: { action: 'payment.orphaned' },
      orderBy: { createdAt: 'desc' },
    });
    expect(orphanAudit).toBeTruthy();
    expect(await snap(flightA)).toEqual(before); // payment path touched nothing
  });

  // ── C2B (paybill) ────────────────────────────────────────────────────────

  it('validates C2B before money moves', async () => {
    const booking = await book(flightB);
    const body = (billRef: string, amount: string) => ({
      TransID: `V${stamp}${transSeq++}`,
      TransAmount: amount,
      BillRefNumber: billRef,
      MSISDN: '254712345678',
    });

    const unknown = await request(server())
      .post(CB('c2b/validate'))
      .set('content-type', 'application/json')
      .send(body('ZZZZZZ', '100.00'))
      .expect(200);
    expect(unknown.body.ResultCode).toBe('400.001.01'); // unknown account

    const badAmount = await request(server())
      .post(CB('c2b/validate'))
      .set('content-type', 'application/json')
      .send(body(booking.pnr, '0'))
      .expect(200);
    expect(badAmount.body.ResultCode).toBe('400.001.02'); // invalid amount

    const ok = await request(server())
      .post(CB('c2b/validate'))
      .set('content-type', 'application/json')
      .send(body(booking.pnr.toLowerCase(), String(booking.totalMinor / 100)))
      .expect(200);
    expect(ok.body.ResultCode).toBe('0'); // PNR normalised + payable
  });

  it('confirms an exactly-matched C2B payment once, even when re-delivered', async () => {
    const before = await snap(flightB);
    const booking = await book(flightB);
    const transId = `M${stamp}${transSeq++}`;
    createdTransIds.push(transId);
    const body = {
      TransID: transId,
      TransAmount: String(booking.totalMinor / 100),
      BillRefNumber: booking.pnr,
      MSISDN: '254712345678',
      TransTime: '20261009104530',
    };

    await request(server())
      .post(CB('c2b/confirm'))
      .set('content-type', 'application/json')
      .send(body)
      .expect(200);
    await request(server())
      .post(CB('c2b/confirm'))
      .set('content-type', 'application/json')
      .send(body)
      .expect(200);

    await waitFor('C2B matched', async () => {
      const row = await prisma.mpesaC2BPayment.findUnique({ where: { transId } });
      return row?.status === 'MATCHED' ? row : null;
    });
    await waitFor('booking CONFIRMED via C2B', () =>
      bookingStatus(booking.id).then((s) => (s === 'CONFIRMED' ? true : null)),
    );
    await sleep(600);

    const rows = await prisma.mpesaC2BPayment.findMany({ where: { transId } });
    expect(rows).toHaveLength(1); // deduped by unique TransID
    const after = await snap(flightB);
    expect(after.sold).toBe(before.sold + 1); // no double sell on re-delivery

    const c2bPayment = await prisma.payment.findFirst({
      where: { idempotencyKey: `c2b:${transId}` },
    });
    expect(c2bPayment?.status).toBe('PAID');
    expect(c2bPayment?.provider).toBe('MPESA_C2B');
    expect(c2bPayment?.amountMinor).toBe(booking.totalMinor);
  });

  it('classifies C2B edge cases: underpaid, overpaid, unknown, late', async () => {
    const before = await snap(flightB);
    const confirm = async (
      booking: { id: string; pnr: string; totalMinor: number } | null,
      billRef: string,
      amountMinor: number,
      label: string,
    ) => {
      const transId = `${label}${stamp}${transSeq++}`;
      createdTransIds.push(transId);
      await request(server())
        .post(CB('c2b/confirm'))
        .set('content-type', 'application/json')
        .send({
          TransID: transId,
          TransAmount: String(amountMinor / 100),
          BillRefNumber: billRef,
          MSISDN: '254712345678',
        })
        .expect(200);
      const row = await waitFor(`C2B ${label} processed`, async () => {
        const r = await prisma.mpesaC2BPayment.findUnique({ where: { transId } });
        return r && r.status !== 'RECEIVED' ? r : null;
      });
      return { transId, row, booking };
    };

    // underpaid → recorded, booking untouched
    const under = await book(flightB);
    const u = await confirm(under, under.pnr, under.totalMinor - 100, 'U');
    expect(u.row.status).toBe('UNDERPAID');
    expect(u.row.bookingId).toBe(under.id);
    expect(await bookingStatus(under.id)).toBe('HELD');

    // overpaid → confirmed + flagged for finance
    const over = await book(flightB);
    const o = await confirm(over, over.pnr, over.totalMinor + 100, 'O');
    expect(o.row.status).toBe('OVERPAID');
    expect(o.row.notes).toMatch(/Overpaid by KES 1/i);
    expect(await bookingStatus(over.id)).toBe('CONFIRMED');
    const overPayment = await prisma.payment.findFirst({
      where: { idempotencyKey: `c2b:${o.transId}` },
    });
    expect(overPayment?.amountMinor).toBe(over.totalMinor + 100);

    // unknown account → suspense, no booking effect
    const x = await confirm(null, `N${stamp}X`, 500_00, 'N');
    expect(x.row.status).toBe('UNKNOWN_ACCOUNT');
    expect(x.row.bookingId).toBeNull();

    // late (booking already confirmed by STK) → no second confirmation
    const late = await book(flightB);
    const latePayment = await pay(late.id);
    await request(server())
      .post(`/api/v1/payments/${latePayment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    const mid = await snap(flightB);
    const l = await confirm(late, late.pnr, late.totalMinor, 'L');
    expect(l.row.status).toBe('LATE_PAYMENT');
    expect(l.row.bookingId).toBe(late.id);
    await sleep(400);
    expect(await bookingStatus(late.id)).toBe('CONFIRMED');
    expect(await snap(flightB)).toEqual(mid); // nothing sold twice

    // net effect: under(no), over(+1), late(+1 from STK), unknown(no)
    const after = await snap(flightB);
    expect(after.sold).toBe(before.sold + 2);
  });

  // ── refunds ──────────────────────────────────────────────────────────────

  async function requestRefundOtp(): Promise<string> {
    await request(server())
      .post('/api/v1/auth/otp/request')
      .send({ destination: financePhone, purpose: 'REFUND' })
      .expect(202);
    const notification = await waitFor('otp notification', () =>
      prisma.notification.findFirst({
        where: { recipient: financePhone, templateCode: 'otp.refund' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const match = /code is (\d{6})/.exec(notification.body ?? '');
    expect(match, 'OTP code present in mock SMS body').toBeTruthy();
    return match![1];
  }

  it('gates refunds behind FINANCE role, amount checks and an OTP step-up', async () => {
    const booking = await book(flightC);
    const payment = await pay(booking.id);
    await request(server())
      .post(`/api/v1/payments/${payment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    const settled = await snap(flightC); // one seat sold for this booking

    // passenger cannot refund at all
    await request(server())
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set('Cookie', ownerCookie)
      .send({ reason: 'nope', otp: '123456' })
      .expect(403);

    // over-refund is rejected BEFORE the OTP is consumed
    await request(server())
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set('Cookie', financeCookie)
      .send({ reason: 'too much', otp: '000000', amountMinor: (payment.amountMinor as number) + 1 })
      .expect(409);

    // wrong OTP → 401
    await request(server())
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set('Cookie', financeCookie)
      .send({ reason: 'bad code', otp: '999999' })
      .expect(401);

    // correct OTP → full refund
    const otp = await requestRefundOtp();
    const res = await request(server())
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set('Cookie', financeCookie)
      .send({ reason: 'Schedule change', otp })
      .expect(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.amountMinor).toBe(payment.amountMinor);
    expect(res.body.providerRef).toMatch(/^MOCKRFND_/);

    const finalPayment = await paymentRow(payment.id as string);
    expect(finalPayment.status).toBe('REFUNDED');
    expect(await bookingStatus(booking.id)).toBe('REFUNDED');

    // the sold seat went back to the pool
    const after = await snap(flightC);
    expect(after.sold).toBe(settled.sold - 1);
    expect(after.held).toBe(settled.held);
  });

  it('partial refund keeps the booking confirmed', async () => {
    const booking = await book(flightC);
    const payment = await pay(booking.id);
    await request(server())
      .post(`/api/v1/payments/${payment.id}/simulate`)
      .set('Cookie', ownerCookie)
      .send({ resultCode: 0 })
      .expect(200);
    const settled = await snap(flightC);

    const otp = await requestRefundOtp();
    const res = await request(server())
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set('Cookie', financeCookie)
      .send({ reason: 'Goodwill credit', otp, amountMinor: 10_000 })
      .expect(201);
    expect(res.body.status).toBe('COMPLETED');

    const finalPayment = await paymentRow(payment.id as string);
    expect(finalPayment.status).toBe('PARTIALLY_REFUNDED');
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED'); // seat still theirs
    expect(await snap(flightC)).toEqual(settled); // inventory untouched
  });

  // ── reconciliation + access control ──────────────────────────────────────

  it('reconciles stale PENDING attempts (poll counter + terminal application)', async () => {
    const booking = await book(flightD);
    const payment = await pay(booking.id);
    const tx = await latestTx(payment.id as string);
    await prisma.mpesaTransaction.update({
      where: { id: tx!.id },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });

    const polled = await payments.reconcileOnce();
    expect(polled).toBeGreaterThanOrEqual(1);

    const after = await prisma.mpesaTransaction.findUnique({ where: { id: tx!.id } });
    expect(after?.queryAttempts).toBeGreaterThanOrEqual(1);
    expect(after?.lastPolledAt).toBeTruthy();
    expect(after?.status).toBe('PENDING'); // mock provider has no external answer

    // when the provider reports success (lost callback recovered), the normal
    // state machine applies — same code path the reconcile worker uses
    const outcome = await payments.applyStkResult(
      tx!.id,
      {
        merchantRequestId: 'm',
        checkoutRequestId: tx!.checkoutRequestId,
        resultCode: 0,
        resultDesc: 'recovered via reconcile',
        amountMajor: tx!.amountMinor / 100,
        receipt: `RCTREC${stamp}`,
      },
      'reconcile',
    );
    expect(outcome).toBe('paid');
    expect((await paymentRow(payment.id as string)).status).toBe('PAID');
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
    const settled = await prisma.mpesaTransaction.findUnique({ where: { id: tx!.id } });
    expect(settled?.reconciledAt).toBeTruthy();
  });

  it('enforces payment access control', async () => {
    const booking = await book(flightD);
    const payment = await pay(booking.id);

    await request(server())
      .get(`/api/v1/payments/${payment.id}`)
      .set('Cookie', otherCookie)
      .expect(403);

    const mine = await request(server())
      .get(`/api/v1/payments/${payment.id}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.id).toBe(payment.id);

    // staff (FINANCE) may view any payment
    await request(server())
      .get(`/api/v1/payments/${payment.id}`)
      .set('Cookie', financeCookie)
      .expect(200);

    // someone else's booking cannot be paid
    await request(server())
      .post('/api/v1/payments')
      .set('Cookie', otherCookie)
      .send({ bookingId: booking.id })
      .expect(403);

    const list = await request(server())
      .get('/api/v1/payments')
      .query({ bookingId: booking.id })
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  it('settles the manual paybill flow on paste: record CONFIRMED, payment PAID, booking CONFIRMED', async () => {
    const booking = await book(flightD);
    const payment = await request(server())
      .post('/api/v1/payments')
      .set('Cookie', ownerCookie)
      .send({ bookingId: booking.id, manual: true })
      .expect(201);
    expect(payment.body.manual).toBe(true);
    expect(payment.body.status).toBe('REQUIRES_ACTION');

    // Passenger pays the number by hand, then pastes the confirmation SMS —
    // no staff step: everything lands in one call. Receipts are 9–10 chars
    // mixing letters and digits (what the parser — and Safaricom — expects).
    const receipt = `MAN${stamp.slice(-5).toUpperCase()}${receiptSeq++ % 10}`;
    const amountMajor = booking.totalMinor / 100;
    const sms =
      `${receipt} confirmed. Ksh${amountMajor.toFixed(2)} sent to ACCOUNT 0182774255 ` +
      `for account ${booking.pnr} on 18/10/26 at 3:45 PM. New M-PESA balance is Ksh9,000.00.`;

    const pasted = await request(server())
      .post(`/api/v1/payments/${payment.body.id}/mpesa-manual`)
      .set('Cookie', ownerCookie)
      .send({ message: sms })
      .expect(201);
    expect(pasted.body.record.status).toBe('CONFIRMED');
    expect(pasted.body.record.receiptNumber).toBe(receipt);
    expect(pasted.body.payment.status).toBe('PAID');

    const fresh = await request(server())
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(fresh.body.status).toBe('CONFIRMED');

    // The same receipt can never confirm a second payment.
    const replay = await request(server())
      .post(`/api/v1/payments/${payment.body.id}/mpesa-manual`)
      .set('Cookie', ownerCookie)
      .send({ message: sms })
      .expect(409);
    expect(replay.body.error.code).toBe('CONFLICT');
  });
});
