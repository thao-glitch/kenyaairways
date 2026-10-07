import { BOOKING_STATUSES, type BookingStatus } from './domain';

/**
 * Booking state machine — the single source of truth used by REST handlers,
 * BullMQ workers and the ops dashboard. Invalid transitions raise 409.
 *
 *   HELD ──► PENDING_PAYMENT ──► CONFIRMED ──► CHECKED_IN ──► FLOWN
 *     │            │                │             │
 *     ▼            ▼                ▼             ▼
 *  EXPIRED/    EXPIRED/         CANCELLED ──► REFUNDED
 *  CANCELLED   CANCELLED        REFUNDED
 */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HELD: ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'REFUNDED', 'FLOWN'],
  CHECKED_IN: ['FLOWN', 'CANCELLED', 'REFUNDED'],
  FLOWN: [],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
  EXPIRED: [],
};

const TERMINAL: readonly BookingStatus[] = ['FLOWN', 'REFUNDED', 'EXPIRED'];

export function allowedTransitions(from: BookingStatus): readonly BookingStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL.includes(status);
}

/** Booking still consumes inventory / seats. */
export function holdsInventory(status: BookingStatus): boolean {
  return status === 'HELD' || status === 'PENDING_PAYMENT' || status === 'CONFIRMED';
}

/** Passenger can be retrieved / managed by the customer. */
export function isManaged(status: BookingStatus): boolean {
  return status !== 'EXPIRED';
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(
      `Invalid booking transition ${from} → ${to} (allowed: ${TRANSITIONS[from].join(', ') || 'none'})`,
    );
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}
