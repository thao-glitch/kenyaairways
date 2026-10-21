/**
 * The local engine router — one function that answers the same requests the
 * app sends to the NestJS API, from the on-device SQLite world.
 *
 * Paths match the server exactly (including the `/api/v1` prefix), and every
 * failure comes back through the shared error envelope with the same HTTP
 * status (`HTTP_STATUS_BY_CODE`), so `api.ts` behaves identically online and
 * offline. Auth, validation and role gates are enforced here — nothing is
 * trusted from the caller.
 */
import bcrypt from 'bcryptjs';
import {
  AppError,
  DEFAULT_LOCALE,
  httpStatusFor,
  normalizeKenyanPhone,
  type MobileSessionDto,
  type SessionUserDto,
} from '@kenyaairways/shared';
import {
  requireAuth,
  requireRole,
  resolveActor,
  syncLocalIdentity,
  toSessionUser,
  type Actor,
  type EngineCtx,
  type UserRow,
} from './engine-support';
import {
  adminBulkPrices,
  adminListBookings,
  adminListUsers,
  adminListFlights,
  adminSetFlightPrices,
  getSiteSettings,
  loadReport,
  recordDirect,
  revenueReport,
  updateSiteSettings,
  verifierCheck,
  verifierConfirm,
  verifierList,
  verifierReject,
  verifierVerify,
} from './engine-admin';
import {
  baggageForBooking,
  cancelBooking,
  checkIn,
  createBooking,
  getBoardingPass,
  getBooking,
  getCheckInsByBooking,
  holdSeat,
  issueBookingTickets,
  listMyBookings,
} from './engine-bookings';
import {
  flightDetail,
  flightPosition,
  flightStatus,
  searchFlights,
  seatMap,
} from './engine-flights';
import { issueSession, parseToken } from './session';
import type { LocalRequest, LocalResponse } from './types';

const BCRYPT_COST = 10;

/** Top-level entry: never throws — errors become error-envelope responses. */
export function handle(ctx: EngineCtx, req: LocalRequest): LocalResponse {
  try {
    return { status: 200, body: route(ctx, req) };
  } catch (err) {
    if (err instanceof AppError) {
      return {
        status: httpStatusFor(err.code),
        body: { error: { code: err.code, message: err.message, details: err.details } },
      };
    }
    const message = err instanceof Error ? err.message : 'Local engine failure';
    return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
  }
}

function route(ctx: EngineCtx, req: LocalRequest): unknown {
  const method = req.method.toUpperCase();
  const path = trimPath(req.path);
  const seg = path.split('/'); // ['api','v1', ...] or ['healthz']

  // ── unauthenticated ───────────────────────────────────────────────────────
  if (method === 'GET' && (path === 'healthz' || path === 'api/v1/healthz')) {
    return { status: 'ok', version: 'offline-1.0.0', uptimeSec: 0, checks: [] };
  }
  if (method === 'GET' && path === 'api/v1/meta') return ctx.world.meta;
  if (method === 'GET' && path === 'api/v1/airports') return airports(ctx);
  if (method === 'GET' && path === 'api/v1/site-settings') return getSiteSettings(ctx);

  if (method === 'POST' && path === 'api/v1/auth/login') return login(ctx, req);
  if (method === 'POST' && path === 'api/v1/auth/register') return register(ctx, req);
  if (method === 'POST' && path === 'api/v1/auth/refresh') return refresh(ctx, req);

  if (seg[0] !== 'api' || seg[1] !== 'v1') {
    throw new AppError('NOT_FOUND', `No local route for ${method} /${path}`);
  }
  const rest = seg.slice(2); // version-relative segments

  if (rest[0] === 'auth' && rest[1] === 'me' && method === 'GET') {
    return requireAuth(resolveActor(ctx, req)).user;
  }

  // ── flights ───────────────────────────────────────────────────────────────
  if (rest[0] === 'flights') {
    if (rest[1] === 'search' && method === 'GET') return searchFlights(ctx, req.query);
    if (rest.length === 2 && method === 'GET') return flightDetail(ctx, rest[1]);
    if (rest.length === 3 && rest[2] === 'status' && method === 'GET') {
      return flightStatus(ctx, rest[1]);
    }
    if (rest.length === 3 && rest[2] === 'position' && method === 'GET') {
      return flightPosition(ctx, rest[1]);
    }
    if (rest.length === 3 && rest[2] === 'seats' && method === 'GET') {
      return seatMap(ctx, rest[1]);
    }
  }

  // ── bookings ──────────────────────────────────────────────────────────────
  if (rest[0] === 'bookings') {
    const actor = requireAuth(resolveActor(ctx, req));
    if (rest.length === 1 && method === 'GET') {
      return listMyBookings(ctx, actor, req.query.page, req.query.pageSize);
    }
    if (rest.length === 1 && method === 'POST') {
      return createBooking(ctx, actor, (req.body ?? {}) as Parameters<typeof createBooking>[2]);
    }
    if (rest.length === 2 && method === 'GET') return getBooking(ctx, actor, rest[1]);
    if (rest.length === 3 && rest[2] === 'cancel' && method === 'POST') {
      return cancelBooking(ctx, actor, rest[1]);
    }
    if (rest.length === 3 && rest[2] === 'seats' && method === 'POST') {
      return holdSeatFromBody(ctx, actor, rest[1], req.body);
    }
  }

  // ── check-in / boarding passes ────────────────────────────────────────────
  if (rest[0] === 'check-in') {
    const actor = requireAuth(resolveActor(ctx, req));
    if (rest.length === 1 && method === 'POST') {
      const body = (req.body ?? {}) as { bookingId?: string; passengerIds?: string[] };
      if (!body.bookingId) throw new AppError('BAD_REQUEST', 'bookingId is required');
      return checkIn(ctx, actor, body.bookingId, body.passengerIds);
    }
    if (rest.length === 1 && method === 'GET') {
      const bookingId = req.query.bookingId;
      if (!bookingId) throw new AppError('BAD_REQUEST', 'bookingId is required');
      return getCheckInsByBooking(ctx, actor, bookingId);
    }
    if (rest[1] === 'bookings' && rest[3] === 'baggage' && method === 'GET') {
      return baggageForBooking(ctx, actor, rest[2]);
    }
  }
  if (rest[0] === 'boarding-passes' && rest.length === 2 && method === 'GET') {
    const actor = requireAuth(resolveActor(ctx, req));
    return getBoardingPass(ctx, actor, rest[1]);
  }

  // ── ticketing ─────────────────────────────────────────────────────────────
  if (rest[0] === 'ticketing' && rest[1] === 'issue' && method === 'POST') {
    const actor = requireAuth(resolveActor(ctx, req));
    const body = (req.body ?? {}) as { bookingId?: string };
    if (!body.bookingId) throw new AppError('BAD_REQUEST', 'bookingId is required');
    return issueBookingTickets(ctx, actor, body.bookingId);
  }

  // ── reports ───────────────────────────────────────────────────────────────
  if (rest[0] === 'reports') {
    const actor = requireAuth(resolveActor(ctx, req));
    if (rest[1] === 'revenue' && method === 'GET') {
      requireRole(actor, ['FINANCE', 'ADMIN']);
      return revenueReport(ctx, req.query);
    }
    if (rest[1] === 'load' && method === 'GET') {
      requireRole(actor, ['FINANCE', 'ADMIN', 'OPS']);
      return loadReport(ctx, req.query);
    }
  }

  // ── admin ─────────────────────────────────────────────────────────────────
  if (rest[0] === 'admin') {
    const actor = requireAuth(resolveActor(ctx, req));
    return adminRoute(ctx, actor, req, rest.slice(1));
  }

  throw new AppError('NOT_FOUND', `No local route for ${method} /api/v1/${rest.join('/')}`);
}

// ── admin sub-router ────────────────────────────────────────────────────────

function adminRoute(ctx: EngineCtx, actor: Actor, req: LocalRequest, rest: string[]): unknown {
  const method = req.method.toUpperCase();

  if (rest[0] === 'flights') {
    requireRole(actor, ['ADMIN', 'FINANCE', 'OPS']);
    if (rest.length === 1 && method === 'GET') return adminListFlights(ctx, req.query);
    if (rest.length === 3 && rest[2] === 'fares' && method === 'PATCH') {
      const body = (req.body ?? {}) as {
        fares?: Array<{ fareClassCode?: string; baseFareMinor?: number }>;
      };
      return adminSetFlightPrices(ctx, rest[1], body.fares ?? []);
    }
    if (rest.length === 2 && rest[1] === 'bulk-prices' && method === 'POST') {
      return adminBulkPrices(ctx, (req.body ?? {}) as Parameters<typeof adminBulkPrices>[1]);
    }
  }

  if (rest[0] === 'bookings') {
    requireRole(actor, ['ADMIN', 'AGENT', 'FINANCE']);
    if (rest.length === 1 && method === 'GET') return adminListBookings(ctx, req.query.q);
    if (rest.length === 3 && rest[2] === 'pay' && method === 'POST') {
      return recordDirect(
        ctx,
        actor,
        rest[1],
        (req.body ?? {}) as Parameters<typeof recordDirect>[3],
      );
    }
  }

  if (rest[0] === 'users' && rest.length === 1 && method === 'GET') {
    requireRole(actor, ['ADMIN']);
    return adminListUsers(ctx, req.query.page, req.query.pageSize);
  }

  if (rest[0] === 'site-settings' && rest.length === 1 && method === 'PATCH') {
    requireRole(actor, ['ADMIN']);
    const body = (req.body ?? {}) as { appName?: unknown; theme?: unknown; images?: unknown };
    return updateSiteSettings(ctx, actor, body);
  }

  if (rest[0] === 'mpesa-verifier') {
    requireRole(actor, ['FINANCE', 'ADMIN']);
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    if (rest[1] === 'parse' && method === 'POST') {
      return verifierCheck(ctx, actor, { message: body.message ?? '' });
    }
    if (rest[1] === 'verify' && method === 'POST') {
      return verifierVerify(ctx, actor, {
        message: body.message ?? '',
        pnr: body.pnr,
        paymentId: body.paymentId,
        notes: body.notes,
      });
    }
    if (rest[1] === 'records' && rest.length === 2 && method === 'GET') {
      return verifierList(ctx, req.query);
    }
    if (rest[1] === 'records' && rest[3] === 'confirm' && method === 'POST') {
      return verifierConfirm(ctx, actor, rest[2], body.notes);
    }
    if (rest[1] === 'records' && rest[3] === 'reject' && method === 'POST') {
      return verifierReject(ctx, actor, rest[2], body.reason ?? '');
    }
  }

  throw new AppError('NOT_FOUND', `No local route for ${method} /admin/${rest.join('/')}`);
}

// ── auth ────────────────────────────────────────────────────────────────────

function login(
  ctx: EngineCtx,
  req: LocalRequest,
): { user: SessionUserDto; session?: MobileSessionDto } {
  const body = (req.body ?? {}) as { identifier?: string; password?: string };
  const identifier = (body.identifier ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!identifier || !password) {
    throw new AppError('VALIDATION_ERROR', 'identifier and password are required');
  }
  const user = findUser(ctx, identifier);
  if (!user) throw new AppError('UNAUTHENTICATED', 'Wrong email/phone or password');
  if (user.status !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', 'This account is not active — contact the airline');
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    throw new AppError('UNAUTHENTICATED', 'Wrong email/phone or password');
  }

  const sessionUser = toSessionUser(user);
  const session = issueSession(sessionUser, Math.floor(ctx.now() / 1000));
  syncLocalIdentity(ctx, sessionUser, session);
  return { user: sessionUser, session };
}

interface RegisterBody {
  email?: string;
  phone?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  acceptTerms?: boolean;
  locale?: string;
}

function register(
  ctx: EngineCtx,
  req: LocalRequest,
): { user: SessionUserDto; session?: MobileSessionDto } {
  const body = (req.body ?? {}) as RegisterBody;
  const email = body.email?.trim().toLowerCase() || null;
  const phoneRaw = body.phone?.trim() || null;
  if (!email && !phoneRaw) {
    throw new AppError('VALIDATION_ERROR', 'email or phone is required');
  }
  const password = body.password ?? '';
  if (password.length < 8) {
    throw new AppError('VALIDATION_ERROR', 'password must be at least 8 characters');
  }
  if (body.acceptTerms !== true) {
    throw new AppError('VALIDATION_ERROR', 'acceptTerms must be accepted');
  }
  const firstName = body.firstName?.trim() || '';
  const lastName = body.lastName?.trim() || '';
  if (!firstName || !lastName) {
    throw new AppError('VALIDATION_ERROR', 'firstName and lastName are required');
  }
  let phone: string | null = null;
  if (phoneRaw) {
    try {
      phone = normalizeKenyanPhone(phoneRaw);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'phone must be a Kenyan number');
    }
  }
  if (email) {
    const clash = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
    if (clash) throw new AppError('CONFLICT', 'An account with this email already exists');
  }
  if (phone) {
    const clash = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE phone = ?', [phone]);
    if (clash) throw new AppError('CONFLICT', 'An account with this phone already exists');
  }

  const id = `usr_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const nowIso = new Date(ctx.now()).toISOString();
  const hash = bcrypt.hashSync(password, BCRYPT_COST);
  ctx.db.run(
    `INSERT INTO users (id, email, phone, passwordHash, firstName, lastName, role, status,
                        locale, emailVerified, phoneVerified, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'PASSENGER', 'ACTIVE', ?, ?, ?, ?)`,
    [
      id,
      email,
      phone,
      hash,
      firstName,
      lastName,
      body.locale ?? DEFAULT_LOCALE,
      email ? 1 : 0,
      phone ? 1 : 0,
      nowIso,
    ],
  );
  const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])!;
  const sessionUser = toSessionUser(row);
  const session = issueSession(sessionUser, Math.floor(ctx.now() / 1000));
  syncLocalIdentity(ctx, sessionUser, session);
  return { user: sessionUser, session };
}

/**
 * Refresh: accepts whatever refresh token the device holds — a local `locr.`
 * or the remote JWT stored at last login — and mints a fresh LOCAL token pair.
 * (Offline we cannot rotate the backend's JWT, so identity continuity comes
 * from the device-local session.)
 */
function refresh(
  ctx: EngineCtx,
  req: LocalRequest,
): { rotated: boolean; session?: MobileSessionDto } {
  const body = (req.body ?? {}) as { refreshToken?: string };
  const token = body.refreshToken ?? '';
  const nowSec = Math.floor(ctx.now() / 1000);

  let uid: string | null = null;
  if (token.startsWith('locr.')) {
    uid = requireLocalUidSafe(token, nowSec);
  } else if (token) {
    const row = ctx.db.get<{ user_id: string; refresh_token: string }>(
      'SELECT user_id, refresh_token FROM local_session WHERE id = 1',
    );
    if (row && row.refresh_token === token) uid = row.user_id;
  }
  if (!uid) throw new AppError('UNAUTHENTICATED', 'Refresh token is not recognised on this device');

  const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [uid]);
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError('UNAUTHENTICATED', 'Account unavailable');
  }
  const sessionUser = toSessionUser(user);
  const session = issueSession(sessionUser, nowSec);
  syncLocalIdentity(ctx, sessionUser, session);
  return { rotated: true, session };
}

function requireLocalUidSafe(token: string, nowSec: number): string | null {
  try {
    return parseToken(token, 'locr', nowSec);
  } catch {
    return null;
  }
}

function findUser(ctx: EngineCtx, identifier: string): UserRow | undefined {
  return (
    ctx.db.get<UserRow>('SELECT * FROM users WHERE lower(email) = ?', [identifier]) ??
    ctx.db.get<UserRow>('SELECT * FROM users WHERE phone = ?', [identifier]) ??
    ctx.db.get<UserRow>('SELECT * FROM users WHERE lower(phone) = ?', [identifier])
  );
}

// ── request helpers ─────────────────────────────────────────────────────────

function holdSeatFromBody(ctx: EngineCtx, actor: Actor, bookingId: string, body: unknown): unknown {
  const input = (body ?? {}) as { seatLabel?: string; seatLabels?: string[]; segmentSeq?: number };
  const segmentSeq = typeof input.segmentSeq === 'number' ? input.segmentSeq : 0;
  // The mobile app sends `{seatLabels:[...]}`; the server also accepts
  // `{seatLabel}`. Hold each requested seat in turn (multi-passenger holds).
  const labels = input.seatLabels?.length
    ? input.seatLabels
    : input.seatLabel
      ? [input.seatLabel]
      : [];
  if (labels.length === 0) throw new AppError('BAD_REQUEST', 'seatLabel is required');
  let dto: unknown;
  for (const label of labels) {
    dto = holdSeat(ctx, actor, bookingId, label, segmentSeq);
  }
  return dto;
}

function airports(ctx: EngineCtx): unknown {
  return [...ctx.world.airports.values()]
    .map((a) => ({
      code: a.code,
      name: a.name,
      city: a.city,
      country: a.country,
      timezone: a.timezone,
      latitude: a.latitude,
      longitude: a.longitude,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function trimPath(path: string): string {
  let out = path.split('?')[0];
  if (out.startsWith('/')) out = out.slice(1);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}
