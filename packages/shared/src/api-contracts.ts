import type { Currency, Locale, Role } from './constants';
import type { CabinClass, FlightStatus, RouteType, UserStatus } from './domain';

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
