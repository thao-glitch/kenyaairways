import type { Currency, Locale, Role } from './constants';
import type {
  BookingSource,
  BookingStatus,
  CabinClass,
  C2BStatus,
  CheckInStatus,
  ConsentPurpose,
  DispatchStatus,
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
  SubjectRequestStatus,
  SubjectRequestType,
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

/**
 * Mobile-client session: native apps cannot rely on httpOnly cookies across
 * app restarts, so `POST /auth/login|register|refresh` also returns bearer
 * tokens in the body when the client sends `X-Client: mobile`. The same
 * access token works against every endpoint via `Authorization: Bearer`.
 */
export interface MobileSessionDto {
  accessToken: string;
  /** Store in Keychain/Keystore; post it to /auth/refresh to rotate. */
  refreshToken: string;
  accessTokenExpiresInSec: number;
  user: SessionUserDto;
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

/**
 * Fare-trend advice (Hopper/Kayak style): a plain-language verdict derived
 * from how full the flight is and how close departure is. Heuristic, honest
 * about being an estimate — never a guarantee.
 */
export interface PriceAdviceDto {
  /** BOOK_NOW = fares on this route tend to climb from here; WAIT = still soft. */
  verdict: 'BOOK_NOW' | 'WAIT' | 'FAIR';
  /** 0–100: how strongly the heuristic points at the verdict. */
  confidencePct: number;
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
  /** Estimated CO₂ per passenger in kg (great-circle × aircraft efficiency). */
  co2KgPerPax?: number;
  /** Fare-trend advice for this departure (omit when data is too thin). */
  priceAdvice?: PriceAdviceDto;
}

/** One day of the whole-month fare calendar (Skyscanner style). */
export interface FareCalendarDayDto {
  date: string; // YYYY-MM-DD
  /** Cheapest total for the day, or null when no flights operate. */
  lowestTotalMinor: number | null;
  flightCount: number;
}

export interface FareCalendarDto {
  origin: string;
  destination: string;
  month: string; // YYYY-MM
  currency: Currency;
  days: FareCalendarDayDto[];
  /** The cheapest date found in the month (null when the month is empty). */
  bestDate: string | null;
}

/** Live flight status (Flighty style) for the public status board. */
export interface FlightStatusBoardDto {
  flightId: string;
  flightNumber: string;
  date: string;
  status: FlightStatus;
  origin: AirportRefDto;
  destination: AirportRefDto;
  scheduledDepLocal: string;
  scheduledArrLocal: string;
  estimatedDepLocal: string | null;
  estimatedArrLocal: string | null;
  gate: string | null;
  terminal: string | null;
  delayMinutes: number;
  aircraft: { code: string; name: string } | null;
}

/** A passenger's fare watch (Skyscanner price-alert style). */
export interface PriceAlertDto {
  id: string;
  originCode: string;
  destinationCode: string;
  cabin: CabinClass;
  /** Optional target: alert fires when the route's lowest fare hits it. */
  targetMinor: number | null;
  /** Cheapest fare seen since the alert was created. */
  lowestSeenMinor: number | null;
  status: 'ACTIVE' | 'TRIGGERED' | 'CANCELLED';
  createdAt: string;
  triggeredAt: string | null;
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

/**
 * `GET /fleet` — the operator's fleet (public "Our Aircraft" page data):
 * every aircraft type with real specs, seat/cabin counts and the
 * registrations flying it.
 */
export interface FleetCabinSeatCountDto {
  cabin: CabinClass;
  count: number;
}

export interface FleetTypeDto {
  code: string;
  name: string;
  manufacturer: string;
  rangeKm: number | null;
  cruiseKts: number | null;
  /** grams of CO₂ per passenger-km (lower is greener). */
  co2GramsPerPaxKm: number | null;
  /** active, unblocked seats in the type's seat map. */
  seats: number;
  cabins: FleetCabinSeatCountDto[];
  aircraft: { registration: string; status: string }[];
}

export interface FleetDto {
  types: FleetTypeDto[];
  totalAircraft: number;
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
  /** True when the passenger settles by paying the paybill + pasting the SMS. */
  manual: boolean;
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

/**
 * Admin "payment plans": where an effective payment-method value comes from —
 * environment defaults (`ENV`) or an admin override row (`DATABASE`).
 */
export type PaymentMethodSource = 'ENV' | 'DATABASE';

/** Non-secret, admin-editable details of one payment method. */
export interface PaymentMethodSettingsDto {
  /** mock = deterministic in-process provider; live = Daraja / Stripe. */
  mode?: 'mock' | 'live';
  mpesaEnv?: 'sandbox' | 'production';
  shortcode?: string;
  callbackBaseUrl?: string;
  allowedCallbackIps?: string;
  initiatorName?: string;
}

/**
 * Secret fields are write-only: reads answer with `configured` + a mask only;
 * clients submit a new value to rotate or `''` to clear (env takes over).
 */
export interface PaymentMethodSecretDto {
  configured: boolean;
  /** '••••••••1234' shape — never the value itself. */
  masked: string | null;
}

/** One configured payment method (M-Pesa Daraja, Stripe, Mock). */
export interface PaymentMethodConfigDto {
  provider: PaymentProviderType;
  enabled: boolean;
  source: PaymentMethodSource;
  /** Override version (null = still following environment defaults). */
  version: number | null;
  settings: PaymentMethodSettingsDto;
  secrets: Record<string, PaymentMethodSecretDto>;
  updatedById: string | null;
  updatedAt: string | null;
}

/** Admin "payment plans" view: the default method + every configurable method. */
export interface PaymentPlanDto {
  /** Method NEW payments are created with (in-flight payments unaffected). */
  defaultProvider: PaymentProviderType;
  /** False ⇒ secret fields are rejected (ENCRYPTION_KEY unusable). */
  encryptionKeyConfigured: boolean;
  methods: PaymentMethodConfigDto[];
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

// ── manual M-Pesa paybill verification ──────────────────────────────────────

/**
 * Fields extracted from a pasted M-Pesa confirmation SMS. `valid` is true
 * when a receipt number and an amount were both found — everything else is
 * best-effort (Safaricom wording varies by product and language).
 */
export interface MpesaParsedMessageDto {
  receiptNumber: string | null;
  /** Whole shillings-and-cents from the message, in minor units. */
  amountMinor: number | null;
  paybill: string | null;
  accountReference: string | null;
  msisdn: string | null;
  /** Africa/Nairobi wall time from the message, as an ISO instant. */
  transactionAt: string | null;
  valid: boolean;
}

export type ManualVerifyStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

/** One manually-verified paybill payment (a MpesaManualVerification row). */
export interface MpesaManualVerificationDto {
  id: string;
  receiptNumber: string;
  amountMinor: number;
  currency: Currency;
  msisdn: string | null;
  paybill: string | null;
  accountReference: string | null;
  transactionAt: string | null;
  status: ManualVerifyStatus;
  paymentId: string | null;
  bookingId: string | null;
  pnr: string | null;
  submittedById: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  rejectReason: string | null;
  notes: string | null;
  createdAt: string;
}

/** Staff verifier verdict on a pasted message, before/without committing it. */
export interface MpesaVerifyCheckDto {
  parsed: MpesaParsedMessageDto;
  /** Human-readable problems that block verification (empty = looks good). */
  issues: string[];
  paymentId: string | null;
  bookingId: string | null;
  pnr: string | null;
  amountExpectedMinor: number | null;
  /** False when the receipt number was already used for another payment. */
  receiptAvailable: boolean;
}

// ── site appearance (theme + real photographs) ──────────────────────────────

/** Theme switchable from the admin appearance console. */
export type SiteTheme = 'sky' | 'savanna' | 'ocean' | 'forest' | 'midnight';

/**
 * Admin-managed image URLs. Every key is optional — unset keys fall back to
 * the web app's built-in defaults (real photographs, Wikimedia Commons).
 */
export interface SiteImagesDto {
  /** Home page hero backdrop. */
  hero?: string;
  /** Sign-in / register banner. */
  auth?: string;
  /** 404 page photograph. */
  notFound?: string;
  /** Destination card photograph per airport code (NBO, MBA, …). */
  destinations?: Record<string, string>;
  /** Admin-managed section photographs: `explore`, `plan`, `place:cdg`, … */
  [key: string]: string | Record<string, string> | undefined;
}

/** Public site appearance + the M-Pesa paybill passengers pay into. */
export interface SiteSettingsDto {
  /** Live app name — admin-editable, rendered across every surface. */
  appName: string;
  theme: SiteTheme;
  images: SiteImagesDto;
  /** Paybill number from the active payment plan (e.g. '0182774255'). */
  mpesaPaybill: string | null;
}

// ── admin console: pricing + assistance ─────────────────────────────────────

/** One fare row within an admin flight price listing. */
export interface AdminFlightFareDto {
  fareClassCode: string;
  baseFareMinor: number;
  currency: Currency;
}

/** `GET /admin/flights` — a flight with every publishable fare. */
export interface AdminFlightPriceDto {
  flightId: string;
  flightNumber: string;
  flightDate: string; // YYYY-MM-DD
  originCode: string;
  destinationCode: string;
  status: FlightStatus;
  departureLocal: string;
  fares: AdminFlightFareDto[];
}

/** One class's new price within a single-flight edit (fare families kept). */
export interface FlightPriceFarePatchDto {
  fareClassCode: string;
  baseFareMinor: number;
}

/** `PATCH /admin/flights/:id/fares` — edit each fare class of one flight. */
export interface FlightPricePatchDto {
  fares: FlightPriceFarePatchDto[];
}

/**
 * `POST /admin/flights/bulk-prices` — nudge fares across a filter. Percent
 * only (SET would flatten the fare family: saver = flex).
 */
export interface BulkPriceUpdateDto {
  originCode?: string;
  destinationCode?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  operation: 'ADJUST_PERCENT';
  /** Change in percent, e.g. -10 or 15. */
  value: number;
}

/** Result of a bulk price change (how many flight fare rows moved). */
export interface BulkPriceUpdateResultDto {
  flightsUpdated: number;
  faresUpdated: number;
}

/** `POST /admin/bookings/:id/pay` — record money taken directly by staff. */
export interface RecordPaymentDto {
  /** Usually 'CASH'; any configured provider is accepted for the record. */
  provider: PaymentProviderType;
  /** Defaults to the booking total when omitted. */
  amountMinor?: number;
  /** Receipt / drawer reference shown on the payment record. */
  reference?: string;
}

/** `GET /admin/bookings` — staff directory row. */
export interface AdminBookingSummaryDto {
  id: string;
  pnr: string;
  status: BookingStatus;
  totalMinor: number;
  currency: Currency;
  contactEmail: string | null;
  contactPhone: string | null;
  passengerNames: string[];
  route: string; // 'NBO → CDG'
  flightNumbers: string[];
  paid: boolean;
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

/**
 * `GET /flights/:id/position` — live aircraft position for the mobile map.
 * Positions are interpolated along the great-circle route between the two
 * airports using real departure/arrival times; `source` says whether an
 * external provider (AviationStack/FlightAware adapter) supplied a fix or
 * the schedule did.
 */
export interface FlightPositionDto {
  flightId: string;
  flightNumber: string;
  origin: { code: string; latitude: number; longitude: number };
  destination: { code: string; latitude: number; longitude: number };
  /** Null while the aircraft is on the ground (scheduled or arrived). */
  position: { latitude: number; longitude: number } | null;
  phase: 'SCHEDULED' | 'ENROUTE' | 'LANDED';
  /** 0..1 along the route (1 = arrived). */
  progress: number;
  headingDeg: number;
  altitudeFt: number | null;
  groundSpeedKts: number | null;
  source: 'SCHEDULE' | 'PROVIDER';
  updatedAt: string;
}

// ── baggage tracking (mobile) ───────────────────────────────────────────────

export type BaggageStageCode =
  'NOT_ACCEPTED' | 'ACCEPTED' | 'LOADED' | 'IN_TRANSIT' | 'LANDED' | 'ON_BELT';

/** One step of a bag's journey, derived from real check-in/flight state. */
export interface BaggageEventDto {
  code: BaggageStageCode;
  label: string;
  at: string | null;
  done: boolean;
}

/** One checked bag with its status timeline (derived, never invented). */
export interface BaggageItemDto {
  ticketNumber: string;
  passengerName: string;
  weightKg: number;
  originCode: string;
  destinationCode: string;
  flightNumber: string;
  events: BaggageEventDto[];
  current: BaggageStageCode;
}

/** `GET /bookings/:id/baggage` — all bags on a booking + their journeys. */
export interface BaggageDto {
  bookingId: string;
  pnr: string;
  items: BaggageItemDto[];
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

// ─────────────────────── ops, manifest, reports (M8) ───────────────────────

/** One ticketed passenger row of a flight manifest (KCAA dispatch payload). */
export interface ManifestPassengerDto {
  seq: number;
  pnr: string;
  ticketNumber: string;
  firstName: string;
  lastName: string;
  seatLabel: string | null;
  boardingSequence: number | null;
  checkInStatus: CheckInStatus;
  checkedInAt: string | null;
  fareClass: string;
  nationality: string | null;
  docType: DocType | null;
  baggageKg: number;
}

/** `GET /ops/manifests?flightId=` — ticketed passengers for one flight. */
export interface ManifestDto {
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureUtc: string;
  gate: string | null;
  status: FlightStatus;
  generatedAt: string;
  totals: {
    ticketed: number;
    checkedIn: number;
    seatsAssigned: number;
  };
  passengers: ManifestPassengerDto[];
}

/** `POST /ops/manifests/:flightId/dispatch` — one dispatch attempt (audit row). */
export interface ManifestDispatchDto {
  id: string;
  flightId: string;
  status: DispatchStatus;
  endpoint: string | null;
  operator: string | null;
  attempts: number;
  responseCode: number | null;
  error: string | null;
  payloadDigest: string | null;
  dispatchedAt: string | null;
  createdAt: string;
}

/** One day of `GET /reports/revenue` (Nairobi calendar day, minor units). */
export interface RevenueDayDto {
  day: string; // YYYY-MM-DD (Africa/Nairobi)
  payments: number;
  grossMinor: number;
  refunds: number;
  refundMinor: number;
  netMinor: number;
}

/** `GET /reports/revenue?from=&to=&currency=` — daily gross/refund/net. */
export interface RevenueReportDto {
  from: string;
  to: string;
  currency: string;
  days: RevenueDayDto[];
  totals: Omit<RevenueDayDto, 'day'>;
}

/** One flight row of `GET /reports/load` (sell-through per departure). */
export interface LoadFactorRowDto {
  flightId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  flightDate: string; // YYYY-MM-DD
  status: FlightStatus;
  capacity: number;
  seatsSold: number;
  seatsHeld: number;
  seatsBlocked: number;
  loadFactorPct: number | null;
}

/** `GET /reports/load?from=&to=` — capacity vs sold per flight. */
export interface LoadReportDto {
  from: string;
  to: string;
  rows: LoadFactorRowDto[];
  totals: {
    flights: number;
    capacity: number;
    seatsSold: number;
    loadFactorPct: number | null;
  };
}

/** One row of `GET /me/consents` — consent is an append-only audit trail. */
export interface ConsentDto {
  id: string;
  purpose: ConsentPurpose;
  policyVersion: string;
  granted: boolean;
  grantedAt: string;
  revokedAt: string | null;
  source: string | null;
}

/** One row of `GET /me/dsar` — the subject's own request history. */
export interface SubjectRequestDto {
  id: string;
  type: SubjectRequestType;
  status: SubjectRequestStatus;
  requestedAt: string;
  processedAt: string | null;
  resultKey: string | null; // `sha256:<hex>` digest of an EXPORT bundle
  notes: string | null;
}

/** `POST /me/dsar` response — EXPORT carries the full copy inline. */
export interface SubjectRequestResultDto {
  request: SubjectRequestDto;
  /** EXPORT only: everything held about the subject (own data, unmasked). */
  data?: Record<string, unknown> | null;
}
