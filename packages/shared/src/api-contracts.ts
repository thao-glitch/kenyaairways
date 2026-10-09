import type { Currency, Locale, Role } from './constants';
import type {
  BookingSource,
  BookingStatus,
  CabinClass,
  C2BStatus,
  CheckInStatus,
  DocType,
  FlightStatus,
  MpesaTxStatus,
  PassengerType,
  PaymentProviderType,
  PaymentStatus,
  RefundStatus,
  RefundRoute,
  RouteType,
  SeatMapStatus,
  SeatZone,
  StatusSource,
  TicketStatus,
  TripType,
  UserStatus,
} from './domain';

/** Standard list envelope for paginated endpoints. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface HealthCheck {
  name: string;
  status: 'up' | 'down';
  latencyMs?: number;
  detail?: string;
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSec: number;
  checks: HealthCheck[];
}

export interface MetaDto {
  airline: { name: string; iataCode: string };
  currency: Currency;
  timezone: string;
  locales: Locale[];
  /** Public-safe feature configuration (never secrets). */
  features: {
    mpesa: { enabled: boolean; mode: 'mock' | 'sandbox' | 'production' };
    stripe: { enabled: boolean; mode: 'mock' | 'live' };
    smsProvider: string;
    emailProvider: string;
    simulator: boolean;
  };
  limits: {
    maxPaxPerBooking: number;
    seatHoldTtlSeconds: number;
    checkinWindowOpenHours: number;
    checkinWindowCloseHours: number;
  };
}

export interface AirportDto {
  code: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  timezone: string;
  routeType: RouteType;
  domestic: boolean;
}

export interface SessionUserDto {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  locale: Locale;
  emailVerified: boolean;
  phoneVerified: boolean;
}

/** ADMIN-only user directory row (never exposes password hashes or tokens). */
export interface AdminUserDto {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  status: UserStatus;
  locale: string;
  createdAt: string;
  lastLoginAt: string | null;
}

// ── flight search & pricing (M3) ───────────────────────────────────────────

export interface AirportRefDto {
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
}

/** One configurable tax/fee line applied to a fare. */
export interface PricingLineDto {
  code: string;
  name: string;
  calcType: 'PERCENT' | 'FLAT';
  appliesTo: 'BASE_FARE' | 'TOTAL';
  amountMinor: number;
}

/** Full price breakdown in integer minor units (KES → cents-style ×100). */
export interface PricingDto {
  currency: Currency;
  baseFareMinor: number;
  taxes: PricingLineDto[];
  taxesTotalMinor: number;
  totalMinor: number;
}

export interface FareClassDto {
  code: string;
  name: string;
  cabin: CabinClass;
  baggageKg: number;
  carryOnKg: number;
  changesAllowed: boolean;
  refundable: boolean;
}

export interface FareOptionDto {
  fareClass: FareClassDto;
  seatsAvailable: number;
  pricing: PricingDto;
}

export interface FlightOptionDto {
  flightId: string;
  flightNumber: string;
  routeType: RouteType;
  origin: AirportRefDto;
  destination: AirportRefDto;
  departUtc: string;
  arriveUtc: string;
  departLocal: string;
  arriveLocal: string;
  durationMinutes: number;
  boardingLocal?: string | null;
  status: FlightStatus;
  aircraft: { code: string; name: string } | null;
  fareOptions: FareOptionDto[];
}

export interface FlightSearchQueryDto {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD (airport-local departure date)
  adults: number;
  children: number;
  infants: number;
  cabin: CabinClass;
}

export interface FlightSearchResultDto {
  query: FlightSearchQueryDto;
  results: FlightOptionDto[];
  meta: { count: number; currency: Currency };
}

export interface FareRuleDto {
  routeType: RouteType;
  changeAllowed: boolean;
  changeFeeMinor: number;
  cancelAllowed: boolean;
  cancelFeePercentBps: number;
  noShowFeeMinor: number;
  textEn: string;
  textSw: string | null;
  currency: Currency;
}

export interface FareClassDetailDto extends FareClassDto {
  sortOrder: number;
  rules: FareRuleDto[];
}

// ── bookings (M4) ──────────────────────────────────────────────────────────

export interface BookingBreakdownLineDto {
  code: string;
  label: string;
  amountMinor: number;
}

export interface BookingSegmentDto {
  seq: number;
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departUtc: string;
  arriveUtc: string;
  departLocal: string;
  arriveLocal: string;
  fareClassCode: string;
  fareMinor: number;
  currency: Currency;
}

export interface BookingPassengerDto {
  seq: number;
  type: PassengerType;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  docType: DocType | null;
}

export interface SeatHoldDto {
  flightId: string;
  seatLabel: string;
  status: 'ACTIVE' | 'RELEASED' | 'CONVERTED' | 'EXPIRED';
  expiresAt: string;
}

export interface BookingDto {
  id: string;
  pnr: string;
  status: BookingStatus;
  tripType: TripType;
  source: BookingSource;
  currency: Currency;
  totalMinor: number;
  breakdown: BookingBreakdownLineDto[];
  contactEmail: string | null;
  contactPhone: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  locale: string;
  holdExpiresAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  segments: BookingSegmentDto[];
  passengers: BookingPassengerDto[];
  seatHolds: SeatHoldDto[];
}

/**
 * A payment attempt against a booking. `status` follows the Prisma
 * PaymentStatus enum; `providerRef` is the CheckoutRequestID (M-Pesa STK) or
 * PaymentIntent id (Stripe) — it is what reconciliation and refunds key on.
 */
export interface PaymentDto {
  id: string;
  bookingId: string;
  provider: PaymentProviderType;
  status: PaymentStatus;
  amountMinor: number;
  currency: Currency;
  idempotencyKey: string;
  providerRef: string | null;
  clientSecret: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Money returned to the passenger. FINANCE-gated; OTP step-up to create. */
export interface RefundDto {
  id: string;
  bookingId: string;
  paymentId: string;
  amountMinor: number;
  currency: Currency;
  status: RefundStatus;
  route: RefundRoute;
  reason: string | null;
  requestedById: string;
  approvedById: string | null;
  providerRef: string | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** An incoming paybill (C2B) transaction — matched to a PNR or suspense. */
export interface C2BPaymentDto {
  id: string;
  transId: string;
  billRefNumber: string;
  msisdn: string; // masked (…149) outside ops roles
  amountMinor: number;
  currency: Currency;
  status: C2BStatus;
  bookingId: string | null;
  paymentId: string | null;
  notes: string | null;
  createdAt: string;
}

/** One M-Pesa STK attempt (an MpesaTransaction row) — ops/reconciliation view. */
export interface MpesaTxDto {
  id: string;
  paymentId: string;
  checkoutRequestId: string;
  accountReference: string;
  status: MpesaTxStatus;
  resultCode: number | null;
  resultDesc: string | null;
  mpesaReceiptNumber: string | null;
  queryAttempts: number;
  createdAt: string;
}

// ── ticketing, PNR, flight status (M6) ──────────────────────────────────────

/**
 * An airline-issued e-ticket: one row per passenger (`bookingPassengerId` is
 * unique, so re-issuing a booking is idempotent). `ticketNumber` is the 13-char
 * airline document number.
 */
export interface TicketDto {
  id: string;
  bookingId: string;
  passengerId: string;
  passengerName: string;
  flightId: string;
  seatLabel: string | null;
  ticketNumber: string;
  status: TicketStatus;
  baggageKg: number;
  fareMinor: number;
  taxesMinor: number;
  currency: Currency;
  issuedAt: string | null;
}

/** `GET /pnr/:code` — booking + issued tickets, owner or staff only. */
export interface PnrLookupDto {
  booking: BookingDto;
  tickets: TicketDto[];
}

/** `POST /ticketing/issue` — idempotent: returns existing tickets on replay. */
export interface TicketIssueResultDto {
  tickets: TicketDto[];
  alreadyIssued: boolean;
}

/** One entry of the public flight status timeline. */
export interface FlightStatusEventDto {
  id: string;
  status: FlightStatus;
  gate: string | null;
  delayMinutes: number | null;
  message: string | null;
  source: StatusSource;
  at: string;
}

/** `GET /flights/:id/status` — current status + recent timeline (public). */
export interface FlightStatusDto {
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  status: FlightStatus;
  gate: string | null;
  delayMinutes: number;
  scheduledDepUtc: string;
  scheduledArrUtc: string;
  actualDepUtc: string | null;
  boardingUtc: string | null;
  events: FlightStatusEventDto[];
}

// ─────────────────────── seat map, check-in, boarding pass (M7) ───────────────────────

/** One seat on one flight with its live availability state. */
export interface SeatMapSeatDto {
  id: string;
  label: string;
  row: number;
  letter: string;
  cabin: CabinClass;
  zone: SeatZone;
  status: SeatMapStatus;
  extraFeeMinor: number;
  currency: string;
}

/** `GET /flights/:id/seats` — seat map with hold/booking status (public). */
export interface SeatMapDto {
  flightId: string;
  seatMapId: string;
  aircraftName: string | null;
  seats: SeatMapSeatDto[];
}

export interface CheckInDto {
  id: string;
  bookingId: string;
  bookingPassengerId: string;
  passengerName: string;
  flightId: string;
  seatLabel: string | null;
  status: CheckInStatus;
  boardingSequence: number | null;
  gate: string | null;
  checkedInAt: string | null;
  boardingPassId: string | null;
}

/** `POST /check-in` — check-ins created/known for this request. */
export interface CheckInResultDto {
  checkIns: CheckInDto[];
  bookingStatus: BookingStatus;
}

export interface BoardingPassDto {
  id: string;
  checkInId: string;
  /** IATA BCBP `M1` payload (what the barcode encodes). */
  bcbp: string;
  format: string;
  issuedAt: string;
  passengerName: string;
  ticketNumber: string | null;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureUtc: string;
  boardingUtc: string | null;
  gate: string | null;
  seatLabel: string | null;
  boardingSequence: number | null;
}
