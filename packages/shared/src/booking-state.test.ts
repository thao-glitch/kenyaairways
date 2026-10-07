import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  holdsInventory,
  InvalidTransitionError,
  isTerminal,
} from '../src/booking-state';

describe('booking state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('HELD', 'PENDING_PAYMENT')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'FLOWN')).toBe(true);
  });

  it('allows cancel → refund', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'REFUNDED')).toBe(true);
  });

  it('blocks skipping payment or confirming twice', () => {
    expect(canTransition('HELD', 'CONFIRMED')).toBe(false);
    expect(canTransition('CONFIRMED', 'CONFIRMED')).toBe(false);
    expect(canTransition('FLOWN', 'CANCELLED')).toBe(false);
    expect(canTransition('EXPIRED', 'PENDING_PAYMENT')).toBe(false);
    expect(canTransition('REFUNDED', 'CONFIRMED')).toBe(false);
  });

  it('assertTransition throws a typed error', () => {
    expect(() => assertTransition('HELD', 'CONFIRMED')).toThrow(InvalidTransitionError);
    try {
      assertTransition('HELD', 'CONFIRMED');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as InvalidTransitionError).code).toBe('INVALID_STATE_TRANSITION');
      expect((err as InvalidTransitionError).from).toBe('HELD');
    }
    expect(() => assertTransition('HELD', 'PENDING_PAYMENT')).not.toThrow();
  });

  it('classifies terminal and inventory-holding states', () => {
    expect(isTerminal('FLOWN')).toBe(true);
    expect(isTerminal('REFUNDED')).toBe(true);
    expect(isTerminal('CONFIRMED')).toBe(false);
    expect(holdsInventory('HELD')).toBe(true);
    expect(holdsInventory('PENDING_PAYMENT')).toBe(true);
    expect(holdsInventory('CANCELLED')).toBe(false);
    expect(holdsInventory('EXPIRED')).toBe(false);
  });
});
