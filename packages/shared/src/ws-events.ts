import type { Role } from './constants';
import type {
  BookingStatus,
  FlightStatus,
  NotificationChannel,
  PaymentProviderType,
  PaymentStatus,
} from './domain';

/** Socket.IO namespace shared by api gateway and web client. */
export const RT_NAMESPACE = '/rt';

export const RT_ROOMS = {
  ops: 'ops',
  finance: 'finance',
  board: 'board',
} as const;

export const roomForUser = (userId: string) => `user:${userId}`;
export const roomForBooking = (bookingId: string) => `booking:${bookingId}`;
export const roomForFlight = (flightId: string) => `flight:${flightId}`;

// ── payloads ───────────────────────────────────────────────────────────

export interface FlightStatusChangedPayload {
  eventId: string;
  flightId: string;
  flightNumber: string;
  status: FlightStatus;
  scheduledDepUtc: string;
  actualDepUtc: string | null;
  delayMinutes: number;
  at: string;
}

export interface GateChangedPayload {
  eventId: string;
  flightId: string;
  flightNumber: string;
  gate: string | null;
  previousGate: string | null;
  at: string;
}

export interface DelayUpdatedPayload {
  eventId: string;
  flightId: string;
  flightNumber: string;
  delayMinutes: number;
  estimatedDepUtc: string | null;
  at: string;
}

export interface SeatChangedPayload {
  eventId: string;
  flightId: string;
  seatId: string;
  label: string;
  expiresAt?: string | null;
  at: string;
}

export interface BookingUpdatedPayload {
  eventId: string;
  bookingId: string;
  pnr: string;
  status: BookingStatus;
  holdExpiresAt?: string | null;
  at: string;
}

export interface PaymentUpdatedPayload {
  eventId: string;
  paymentId: string;
  bookingId: string;
  provider: PaymentProviderType;
  status: PaymentStatus;
  checkoutRequestId?: string;
  resultCode?: number;
  resultMessage?: string;
  at: string;
}

export interface NotificationNewPayload {
  eventId: string;
  notificationId: string;
  channel: NotificationChannel;
  templateCode: string;
  preview: string;
  at: string;
}

export interface OpsAlertPayload {
  eventId: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  ref: string;
  detail: string;
  at: string;
}

export interface AckPayload {
  ref?: string;
  ok: boolean;
  message?: string;
}

export interface RtErrorPayload {
  ref?: string;
  code: string;
  message: string;
}

/** Every server→client event, keyed by wire name. */
export interface ServerToClientEvents {
  'flight.status.changed': (payload: FlightStatusChangedPayload) => void;
  'gate.changed': (payload: GateChangedPayload) => void;
  'delay.updated': (payload: DelayUpdatedPayload) => void;
  'seat.held': (payload: SeatChangedPayload) => void;
  'seat.released': (payload: SeatChangedPayload) => void;
  'seat.booked': (payload: SeatChangedPayload) => void;
  'booking.updated': (payload: BookingUpdatedPayload) => void;
  'payment.updated': (payload: PaymentUpdatedPayload) => void;
  'notification.new': (payload: NotificationNewPayload) => void;
  'ops.alert': (payload: OpsAlertPayload) => void;
  ack: (payload: AckPayload) => void;
  error: (payload: RtErrorPayload) => void;
}

export interface RoomJoinPayload {
  room: string;
  /** Replay events after this id (missed-event recovery via Redis stream). */
  sinceEventId?: string;
}

export interface ClientToServerEvents {
  'room.join': (payload: RoomJoinPayload) => void;
  'room.leave': (payload: { room: string }) => void;
  ping: () => void;
}

export type { Role };

/** Authenticated socket context (set by the handshake auth middleware). */
export interface SocketAuthContext {
  userId?: string;
  role?: Role;
}

/** Canonical list of event names — used by the Redis stream publisher and tests. */
export const RT_EVENT_NAMES = [
  'flight.status.changed',
  'gate.changed',
  'delay.updated',
  'seat.held',
  'seat.released',
  'seat.booked',
  'booking.updated',
  'payment.updated',
  'notification.new',
  'ops.alert',
] as const;

export type RtEventName = (typeof RT_EVENT_NAMES)[number];
