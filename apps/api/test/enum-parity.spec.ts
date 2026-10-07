import { describe, expect, it } from 'vitest';
import {
  BookingStatus,
  CabinClass,
  C2BStatus,
  DocType,
  FlightStatus,
  HoldStatus,
  NotificationChannel,
  PassengerType,
  PaymentProviderType,
  PaymentStatus,
  MpesaTxStatus,
  RefundStatus,
  Role,
  RouteType,
  TripType,
  UserStatus,
} from '@prisma/client';
import {
  BOOKING_STATUSES,
  CABIN_CLASSES,
  C2B_STATUSES,
  DOC_TYPES,
  FLIGHT_STATUSES,
  HOLD_STATUSES,
  MPESA_TX_STATUSES,
  NOTIFICATION_CHANNELS,
  PASSENGER_TYPES,
  PAYMENT_PROVIDER_TYPES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  ROUTE_TYPES,
  SUPPORTED_ROLES,
  TRIP_TYPES,
  USER_STATUSES,
} from '@flight13/shared';

/**
 * The shared package mirrors Prisma enums as string unions so the web app can
 * narrow on them. This test fails the moment the two drift apart — the exact
 * failure the comment in domain.ts warns about.
 */
const pairs: Array<[string, readonly string[], object]> = [
  ['Role', SUPPORTED_ROLES, Role],
  ['BookingStatus', BOOKING_STATUSES, BookingStatus],
  ['TripType', TRIP_TYPES, TripType],
  ['CabinClass', CABIN_CLASSES, CabinClass],
  ['FlightStatus', FLIGHT_STATUSES, FlightStatus],
  ['RouteType', ROUTE_TYPES, RouteType],
  ['UserStatus', USER_STATUSES, UserStatus],
  ['PaymentProviderType', PAYMENT_PROVIDER_TYPES, PaymentProviderType],
  ['PaymentStatus', PAYMENT_STATUSES, PaymentStatus],
  ['MpesaTxStatus', MPESA_TX_STATUSES, MpesaTxStatus],
  ['C2BStatus', C2B_STATUSES, C2BStatus],
  ['RefundStatus', REFUND_STATUSES, RefundStatus],
  ['PassengerType', PASSENGER_TYPES, PassengerType],
  ['DocType', DOC_TYPES, DocType],
  ['NotificationChannel', NOTIFICATION_CHANNELS, NotificationChannel],
  ['HoldStatus', HOLD_STATUSES, HoldStatus],
];

describe('shared ↔ prisma enum parity', () => {
  for (const [name, shared, prisma] of pairs) {
    it(`${name} matches the Prisma enum`, () => {
      expect([...shared].sort()).toEqual(Object.values(prisma as Record<string, string>).sort());
    });
  }
});
