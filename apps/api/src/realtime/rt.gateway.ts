import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { type OnModuleDestroy } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { Role } from '@prisma/client';
import {
  RT_NAMESPACE,
  type ClientToServerEvents,
  type RoomJoinPayload,
  type ServerToClientEvents,
} from '@flight13/shared';
import { createLogger, type Logger } from '../common/logger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.module';
import { ACCESS_COOKIE, TokenService } from '../modules/auth/token.service';
import { STAFF_ROLES } from '../modules/bookings/bookings.service';
import { getEnv } from '../config/env';
import { type RtSink, RtEventsService } from './rt-events.service';

export interface RtSocketData {
  userId?: string;
  role?: Role;
  /** Handshake gate — resolves once `userId`/`role` are populated. */
  gate?: Promise<void>;
}

type RtSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<never, never>,
  RtSocketData
>;
type RtServer = Server<ClientToServerEvents, ServerToClientEvents>;

const OPS_ROOM_ROLES: readonly Role[] = ['OPS', 'ADMIN'];
const FINANCE_ROOM_ROLES: readonly Role[] = ['FINANCE', 'ADMIN'];
const BOARD_ROOM_ROLES: readonly Role[] = ['OPS', 'ADMIN'];

/**
 * Socket.IO namespace `/rt`. The handshake must carry the same access token as
 * REST (httpOnly `f13_at` cookie or `auth.token`) — unauthenticated sockets are
 * disconnected before they can subscribe to anything. Every room join is then
 * authorized: your own user room, your bookings (staff see all), flights for
 * any signed-in user, staff dashboards by role.
 */
/**
 * `@Public()`: the HTTP guards are request-shaped (they read `req.headers`)
 * and the global guards also run against `@SubscribeMessage` handlers where no
 * HTTP request exists — they would crash instead of protecting anything.
 * This gateway authenticates the equivalent way itself during the handshake
 * (verified access token + denylist + active account) and re-checks
 * authorization on every room join; RolesGuard is a no-op here (no @Roles).
 */
@Public()
@WebSocketGateway({
  namespace: RT_NAMESPACE,
  cors: {
    origin: getEnv()
      .CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class RtGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer()
  server!: RtServer;

  private readonly log: Logger = createLogger('rt-gw');
  private readonly sink: RtSink = {
    emit: (rooms, event, payload) => {
      // The RtSink signature is already event-checked; socket.io's generic
      // emit defers on the unresolved type parameter, so widen here only.
      // Passing the whole room set makes socket.io deliver one copy per
      // socket even when it sits in several of those rooms.
      const target = this.server.to(rooms) as unknown as {
        emit(ev: string, payload: unknown): void;
      };
      target.emit(event, payload);
    },
  };

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly events: RtEventsService,
  ) {}

  afterInit(): void {
    this.events.registerSink(this.sink);
  }

  onModuleDestroy(): void {
    this.events.unregisterSink(this.sink);
  }

  /**
   * Verify the access token on connect; logout/denylist closes the socket.
   *
   * A client may emit `room.join` the instant the connection opens — before
   * the async verification below finishes. Packet middleware installed here
   * (synchronously, before the first `await`) buffers every incoming packet
   * until the handshake settles, so handlers never observe a
   * half-authenticated socket.
   */
  async handleConnection(socket: RtSocket): Promise<void> {
    let settle!: () => void;
    socket.data.gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    socket.use((_packet, next) => {
      void socket.data.gate!.then(
        () => next(),
        () => next(),
      );
    });
    try {
      const token = extractToken(socket);
      if (!token) throw new Error('no access token');
      const { sub, fam } = await this.tokens.verifyAccess(token);
      if (await this.tokens.isFamilyDenied(fam)) throw new Error('session revoked');
      const user = await this.prisma.user.findUnique({ where: { id: sub } });
      if (!user || user.status !== 'ACTIVE') throw new Error('account not active');

      socket.data.userId = user.id;
      socket.data.role = user.role;
      await socket.join(`user:${user.id}`);
      settle();
    } catch {
      // Release any buffered packets — canJoin denies sockets without data —
      // then close: disconnect happens after the error notice.
      settle();
      emitError(socket, {
        code: 'UNAUTHENTICATED',
        message: 'Valid access token required to open the real-time stream',
      });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('room.join')
  async onRoomJoin(socket: RtSocket, payload: RoomJoinPayload): Promise<void> {
    const room = typeof payload?.room === 'string' ? payload.room : '';
    if (!room) {
      emitError(socket, { code: 'BAD_ROOM', message: 'room is required' });
      return;
    }
    if (!(await this.canJoin(socket.data, room))) {
      this.log.warn('room join denied', { room, userId: socket.data.userId });
      emitError(socket, {
        ref: room,
        code: 'FORBIDDEN',
        message: 'Cannot join this room',
      });
      return;
    }
    await socket.join(room);
    socket.emit('ack', { ref: room, ok: true });
    if (typeof payload.sinceEventId === 'string' && payload.sinceEventId) {
      await this.events.replay(room, payload.sinceEventId);
    }
  }

  @SubscribeMessage('room.leave')
  async onRoomLeave(socket: RtSocket, payload: { room: string }): Promise<void> {
    if (typeof payload?.room === 'string' && payload.room) await socket.leave(payload.room);
    socket.emit('ack', { ref: payload?.room, ok: true });
  }

  @SubscribeMessage('ping')
  onPing(socket: RtSocket): void {
    socket.emit('ack', { ref: 'ping', ok: true, message: 'pong' });
  }

  /** Room policy — see the class doc. Queries only what the answer needs. */
  private async canJoin(data: RtSocketData, room: string): Promise<boolean> {
    if (!data.userId || !data.role) return false;
    const [kind, ...rest] = room.split(':');
    const id = rest.join(':');

    switch (kind) {
      case 'user':
        return id === data.userId;
      case 'flight':
        return true; // any signed-in user may watch a flight
      case 'booking': {
        if (STAFF_ROLES.includes(data.role)) return true;
        const booking = await this.prisma.booking.findUnique({
          where: { id },
          select: { userId: true },
        });
        return booking?.userId === data.userId;
      }
      case 'ops':
        return OPS_ROOM_ROLES.includes(data.role);
      case 'finance':
        return FINANCE_ROOM_ROLES.includes(data.role);
      case 'board':
        return BOARD_ROOM_ROLES.includes(data.role);
      default:
        return false;
    }
  }
}

/**
 * Best-effort error delivery: `error` is a normal user event in socket.io v4
 * but was protocol-level in older revisions — never let a rejection notice
 * throw inside a handler (that would skip the disconnect that follows it).
 */
function emitError(
  socket: RtSocket,
  payload: {
    ref?: string;
    code: string;
    message: string;
  },
): void {
  try {
    socket.emit('error', payload);
  } catch {
    // the disconnect below still enforces the rejection
  }
}

/** Cookie header on the handshake, or `auth: { token }` for tests/CLI clients. */
function extractToken(socket: RtSocket): string | undefined {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token;
  const cookie = socket.handshake.headers.cookie;
  if (cookie) {
    for (const part of cookie.split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === ACCESS_COOKIE) return value.join('=');
    }
  }
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}
