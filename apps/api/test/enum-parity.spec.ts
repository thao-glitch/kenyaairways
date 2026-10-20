import { describe, expect, it } from 'vitest';
import {
  BookingStatus,
  CabinClass,
  C2BStatus,
  CheckInStatus,
  ConsentPurpose,
  DispatchStatus,
  DocType,
  FlightStatus,
  HoldStatus,
  NotificationChannel,
  PassengerType,
  PaymentProviderType,
  PaymentStatus,
  MpesaTxStatus,
  RefundStatus,
  RefundRoute,
  Role,
  RouteType,
  SeatZone,
  StatusSource,
  SubjectRequestStatus,
  SubjectRequestType,
  TicketStatus,
  TripType,
  UserStatus,
} from '@prisma/client';
import {
  BOOKING_STATUSES,
  CABIN_CLASSES,
  C2B_STATUSES,
  CHECK_IN_STATUSES,
  CONSENT_PURPOSES,
  DISPATCH_STATUSES,
  DOC_TYPES,
  FLIGHT_STATUSES,
  HOLD_STATUSES,
  MPESA_TX_STATUSES,
  NOTIFICATION_CHANNELS,
  PASSENGER_TYPES,
  PAYMENT_PROVIDER_TYPES,
  PAYMENT_STATUSES,
  REFUND_ROUTES,
  REFUND_STATUSES,
  ROUTE_TYPES,
  SEAT_ZONES,
  STATUS_SOURCES,
  SUBJECT_REQUEST_STATUSES,
  SUBJECT_REQUEST_TYPES,
  SUPPORTED_ROLES,
  TICKET_STATUSES,
  TRIP_TYPES,
  USER_STATUSES,
} from '@kenyaairways/shared';

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
  ['RefundRoute', REFUND_ROUTES, RefundRoute],
  ['PassengerType', PASSENGER_TYPES, PassengerType],
  ['DocType', DOC_TYPES, DocType],
  ['NotificationChannel', NOTIFICATION_CHANNELS, NotificationChannel],
  ['HoldStatus', HOLD_STATUSES, HoldStatus],
  ['TicketStatus', TICKET_STATUSES, TicketStatus],
  ['StatusSource', STATUS_SOURCES, StatusSource],
  ['CheckInStatus', CHECK_IN_STATUSES, CheckInStatus],
  ['SeatZone', SEAT_ZONES, SeatZone],
  ['DispatchStatus', DISPATCH_STATUSES, DispatchStatus],
  ['ConsentPurpose', CONSENT_PURPOSES, ConsentPurpose],
  ['SubjectRequestType', SUBJECT_REQUEST_TYPES, SubjectRequestType],
  ['SubjectRequestStatus', SUBJECT_REQUEST_STATUSES, SubjectRequestStatus],
];

describe('shared ↔ prisma enum parity', () => {
  for (const [name, shared, prisma] of pairs) {
    it(`${name} matches the Prisma enum`, () => {
      expect([...shared].sort()).toEqual(Object.values(prisma as Record<string, string>).sort());
    });
  }
});
