/**
 * Canonical domain unions shared by API and web.
 * These mirror the Prisma enums 1:1 — an api-side type test guards the drift.
 */

export const BOOKING_STATUSES = [
  'HELD',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'FLOWN',
  'CANCELLED',
  'REFUNDED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SOURCES = ['WEB', 'AGENT', 'ADMIN', 'API'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const TRIP_TYPES = ['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const CABIN_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const FLIGHT_STATUSES = [
  'SCHEDULED',
  'DELAYED',
  'BOARDING',
  'DEPARTED',
  'IN_AIR',
  'LANDED',
  'CANCELLED',
] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

export const ROUTE_TYPES = ['DOMESTIC', 'INTERNATIONAL', 'REGIONAL'] as const;
export type RouteType = (typeof ROUTE_TYPES)[number];

export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PAYMENT_PROVIDER_TYPES = [
  'MPESA_STK',
  'MPESA_C2B',
  'STRIPE',
  'MOCK',
  'AIRTEL_MONEY',
] as const;
export type PaymentProviderType = (typeof PAYMENT_PROVIDER_TYPES)[number];

export const PAYMENT_STATUSES = [
  'REQUIRES_ACTION',
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MPESA_TX_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'] as const;
export type MpesaTxStatus = (typeof MPESA_TX_STATUSES)[number];

export const C2B_STATUSES = [
  'RECEIVED',
  'MATCHED',
  'OVERPAID',
  'UNDERPAID',
  'UNKNOWN_ACCOUNT',
  'LATE_PAYMENT',
  'SUSPENSE',
] as const;
export type C2BStatus = (typeof C2B_STATUSES)[number];

export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_ROUTES = ['MPESA_REVERSAL', 'MPESA_B2C', 'STRIPE', 'MANUAL'] as const;
export type RefundRoute = (typeof REFUND_ROUTES)[number];

export const PASSENGER_TYPES = ['ADULT', 'CHILD', 'INFANT'] as const;
export type PassengerType = (typeof PASSENGER_TYPES)[number];

export const DOC_TYPES = ['ID', 'PASSPORT', 'BIRTH_CERTIFICATE', 'REFUGEE_TRAVEL_DOC'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'INAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const HOLD_STATUSES = ['ACTIVE', 'RELEASED', 'CONVERTED', 'EXPIRED'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];
