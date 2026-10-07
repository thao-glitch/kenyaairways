import type { Currency, Locale, Role } from './constants';
import type { RouteType, UserStatus } from './domain';

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
