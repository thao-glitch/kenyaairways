/**
 * Idempotent seed: Kenyan airport network, fleet with seat maps, fare classes,
 * configurable tax/fee rules (FINANCE MUST CONFIRM RATES), 30 days of flights
 * with fares + inventory, and one user per RBAC role.
 *
 * Run: pnpm db:seed   (safe to re-run; everything upserts)
 */
import {
  PrismaClient,
  type Prisma,
  type RouteType,
  type Role,
  type CabinClass,
  type DocType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getEnv } from '../src/config/env';
import { blindIndex, encryptField } from '../src/common/crypto';

const prisma = new PrismaClient();
const env = getEnv();

// ───────────────────────────── time helpers ─────────────────────────────
function tzOffsetMs(ts: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - ts;
}

/** Wall-clock time in an IANA zone → absolute UTC instant. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesFromMidnight * 60_000;
  const firstPass = guess - tzOffsetMs(guess, timeZone);
  return new Date(guess - tzOffsetMs(firstPass, timeZone));
}

/** Today's date in Nairobi as {y,m,d} shifted by dayOffset. */
function nairobiDate(dayOffset: number): { y: number; m: number; d: number } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const clock = (min: number) => min;

// ───────────────────────────── airports ─────────────────────────────
type Continent =
  'africa' | 'europe' | 'asia' | 'north-america' | 'south-america' | 'oceania' | 'antarctica';

interface SeedAirport {
  code: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  timezone: string;
  latitude: number;
  longitude: number;
  continent: Continent;
  region: RouteType;
  domestic: boolean;
}

/** Hand-entered originals; continents are attached via LEGACY_CONTINENT below. */
type LegacySeedAirport = Omit<SeedAirport, 'continent'>;

const AIRPORTS: LegacySeedAirport[] = [
  {
    code: 'NBO',
    icao: 'HKJK',
    name: 'Jomo Kenyatta International Airport',
    city: 'Nairobi',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -1.3192,
    longitude: 36.9278,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'WIL',
    icao: 'HKWS',
    name: 'Wilson Airport',
    city: 'Nairobi',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -1.3217,
    longitude: 36.8148,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'MBA',
    icao: 'HKMB',
    name: 'Mara Serena Airstrip',
    city: 'Maasai Mara',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -1.4061,
    longitude: 35.0168,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'KIS',
    icao: 'HKKI',
    name: 'Kisumu International Airport',
    city: 'Kisumu',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -0.0861,
    longitude: 34.7289,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'EDL',
    icao: 'HKEL',
    name: 'Eldoret International Airport',
    city: 'Eldoret',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: 0.4045,
    longitude: 35.2389,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'MYD',
    icao: 'HKMY',
    name: 'Manda Airport',
    city: 'Malindi',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -3.2175,
    longitude: 40.1014,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'LAU',
    icao: 'HKLU',
    name: 'Manda Airport',
    city: 'Lamu',
    country: 'Kenya',
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    latitude: -2.2524,
    longitude: 40.9129,
    region: 'DOMESTIC',
    domestic: true,
  },
  {
    code: 'EBB',
    icao: 'HKKA',
    name: 'Entebbe International Airport',
    city: 'Entebbe',
    country: 'Uganda',
    countryCode: 'UG',
    timezone: 'Africa/Kampala',
    latitude: 0.0424,
    longitude: 32.4467,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'DAR',
    icao: 'HTDA',
    name: 'Julius Nyerere International Airport',
    city: 'Dar es Salaam',
    country: 'Tanzania',
    countryCode: 'TZ',
    timezone: 'Africa/Dar_es_Salaam',
    latitude: -6.8781,
    longitude: 39.2026,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'JNB',
    icao: 'FAOR',
    name: 'O.R. Tambo International Airport',
    city: 'Johannesburg',
    country: 'South Africa',
    countryCode: 'ZA',
    timezone: 'Africa/Johannesburg',
    latitude: -26.1367,
    longitude: 28.2411,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'DXB',
    icao: 'OMDB',
    name: 'Dubai International Airport',
    city: 'Dubai',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    timezone: 'Asia/Dubai',
    latitude: 25.2532,
    longitude: 55.3657,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'LHR',
    icao: 'EGLL',
    name: 'Heathrow Airport',
    city: 'London',
    country: 'United Kingdom',
    countryCode: 'GB',
    timezone: 'Europe/London',
    latitude: 51.47,
    longitude: -0.4543,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: Europe ──
  {
    code: 'CDG',
    icao: 'LFPG',
    name: 'Charles de Gaulle Airport',
    city: 'Paris',
    country: 'France',
    countryCode: 'FR',
    timezone: 'Europe/Paris',
    latitude: 49.0097,
    longitude: 2.5479,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'AMS',
    icao: 'EHAM',
    name: 'Schiphol Airport',
    city: 'Amsterdam',
    country: 'Netherlands',
    countryCode: 'NL',
    timezone: 'Europe/Amsterdam',
    latitude: 52.3105,
    longitude: 4.7683,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'FRA',
    icao: 'EDDF',
    name: 'Frankfurt Airport',
    city: 'Frankfurt',
    country: 'Germany',
    countryCode: 'DE',
    timezone: 'Europe/Berlin',
    latitude: 50.0379,
    longitude: 8.5622,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'MAD',
    icao: 'LEMD',
    name: 'Adolfo Suárez Madrid–Barajas Airport',
    city: 'Madrid',
    country: 'Spain',
    countryCode: 'ES',
    timezone: 'Europe/Madrid',
    latitude: 40.4719,
    longitude: -3.5626,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'IST',
    icao: 'LTFM',
    name: 'Istanbul Airport',
    city: 'Istanbul',
    country: 'Türkiye',
    countryCode: 'TR',
    timezone: 'Europe/Istanbul',
    latitude: 41.2753,
    longitude: 28.7519,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: Middle East ──
  {
    code: 'DOH',
    icao: 'OTHH',
    name: 'Hamad International Airport',
    city: 'Doha',
    country: 'Qatar',
    countryCode: 'QA',
    timezone: 'Asia/Qatar',
    latitude: 25.2731,
    longitude: 51.6081,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'RUH',
    icao: 'OERK',
    name: 'King Khalid International Airport',
    city: 'Riyadh',
    country: 'Saudi Arabia',
    countryCode: 'SA',
    timezone: 'Asia/Riyadh',
    latitude: 24.9576,
    longitude: 46.6988,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: Asia ──
  {
    code: 'SIN',
    icao: 'WSSL',
    name: 'Changi Airport',
    city: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    timezone: 'Asia/Singapore',
    latitude: 1.3644,
    longitude: 103.9915,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'HKG',
    icao: 'VHHH',
    name: 'Hong Kong International Airport',
    city: 'Hong Kong',
    country: 'Hong Kong SAR',
    countryCode: 'HK',
    timezone: 'Asia/Hong_Kong',
    latitude: 22.308,
    longitude: 113.9185,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'NRT',
    icao: 'RJAA',
    name: 'Narita International Airport',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    timezone: 'Asia/Tokyo',
    latitude: 35.772,
    longitude: 140.3929,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'BOM',
    icao: 'VABB',
    name: 'Chhatrapati Shivaji Maharaj International Airport',
    city: 'Mumbai',
    country: 'India',
    countryCode: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 19.0896,
    longitude: 72.8656,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'DEL',
    icao: 'VIDP',
    name: 'Indira Gandhi International Airport',
    city: 'Delhi',
    country: 'India',
    countryCode: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 28.5562,
    longitude: 77.1,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: Americas ──
  {
    code: 'JFK',
    icao: 'KJFK',
    name: 'John F. Kennedy International Airport',
    city: 'New York',
    country: 'United States',
    countryCode: 'US',
    timezone: 'America/New_York',
    latitude: 40.6413,
    longitude: -73.7781,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'YYZ',
    icao: 'CYYZ',
    name: 'Toronto Pearson International Airport',
    city: 'Toronto',
    country: 'Canada',
    countryCode: 'CA',
    timezone: 'America/Toronto',
    latitude: 43.6777,
    longitude: -79.6248,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'GRU',
    icao: 'SBGR',
    name: 'São Paulo–Guarulhos International Airport',
    city: 'São Paulo',
    country: 'Brazil',
    countryCode: 'BR',
    timezone: 'America/Sao_Paulo',
    latitude: -23.4356,
    longitude: -46.4731,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: rest of Africa ──
  {
    code: 'LOS',
    icao: 'DNMM',
    name: 'Murtala Muhammed International Airport',
    city: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
    timezone: 'Africa/Lagos',
    latitude: 6.5774,
    longitude: 3.3212,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'CAI',
    icao: 'HECA',
    name: 'Cairo International Airport',
    city: 'Cairo',
    country: 'Egypt',
    countryCode: 'EG',
    timezone: 'Africa/Cairo',
    latitude: 30.1219,
    longitude: 31.4056,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'CPT',
    icao: 'FACT',
    name: 'Cape Town International Airport',
    city: 'Cape Town',
    country: 'South Africa',
    countryCode: 'ZA',
    timezone: 'Africa/Johannesburg',
    latitude: -33.9649,
    longitude: 18.6017,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'ADD',
    icao: 'HAAB',
    name: 'Addis Ababa Bole International Airport',
    city: 'Addis Ababa',
    country: 'Ethiopia',
    countryCode: 'ET',
    timezone: 'Africa/Addis_Ababa',
    latitude: 8.9779,
    longitude: 38.7993,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  // ── worldwide network: Oceania ──
  {
    code: 'SYD',
    icao: 'YSSY',
    name: 'Sydney Kingsford Smith Airport',
    city: 'Sydney',
    country: 'Australia',
    countryCode: 'AU',
    timezone: 'Australia/Sydney',
    latitude: -33.9399,
    longitude: 151.1753,
    region: 'INTERNATIONAL',
    domestic: false,
  },
  {
    code: 'MEL',
    icao: 'YMML',
    name: 'Melbourne Airport',
    city: 'Melbourne',
    country: 'Australia',
    countryCode: 'AU',
    timezone: 'Australia/Melbourne',
    latitude: -37.669,
    longitude: 144.841,
    region: 'INTERNATIONAL',
    domestic: false,
  },
];

/** Continent grouping for the hand-entered originals above. */
const LEGACY_CONTINENT: Record<string, Continent> = {
  NBO: 'africa',
  WIL: 'africa',
  MBA: 'africa',
  KIS: 'africa',
  EDL: 'africa',
  MYD: 'africa',
  LAU: 'africa',
  EBB: 'africa',
  DAR: 'africa',
  JNB: 'africa',
  CPT: 'africa',
  LOS: 'africa',
  CAI: 'africa',
  ADD: 'africa',
  DXB: 'asia',
  DOH: 'asia',
  RUH: 'asia',
  SIN: 'asia',
  HKG: 'asia',
  NRT: 'asia',
  BOM: 'asia',
  DEL: 'asia',
  LHR: 'europe',
  CDG: 'europe',
  AMS: 'europe',
  FRA: 'europe',
  MAD: 'europe',
  IST: 'europe',
  JFK: 'north-america',
  YYZ: 'north-america',
  GRU: 'south-america',
  SYD: 'oceania',
  MEL: 'oceania',
};

/**
 * The rest of the worldwide network — every continent, hub-and-spoke from
 * Nairobi: "we can land anywhere and fly anywhere in the world".
 * [code, icao, name, city, country, cc, timezone, lat, lng, continent]
 */
const WORLD_NETWORK: Array<
  [string, string, string, string, string, string, string, number, number, Continent]
> = [
  // ── Africa ──
  [
    'KGL',
    'HRYR',
    'Kigali International Airport',
    'Kigali',
    'Rwanda',
    'RW',
    'Africa/Kigali',
    -1.9686,
    30.1395,
    'africa',
  ],
  [
    'BJM',
    'HBBA',
    'Bujumbura International Airport',
    'Bujumbura',
    'Burundi',
    'BI',
    'Africa/Bujumbura',
    -3.324,
    29.3185,
    'africa',
  ],
  [
    'ZNZ',
    'HTZA',
    'Abeid Amani Karume International Airport',
    'Zanzibar',
    'Tanzania',
    'TZ',
    'Africa/Dar_es_Salaam',
    -6.222,
    39.225,
    'africa',
  ],
  [
    'HRE',
    'FVHA',
    'Robert Gabriel Mugabe International Airport',
    'Harare',
    'Zimbabwe',
    'ZW',
    'Africa/Harare',
    -17.9318,
    31.0928,
    'africa',
  ],
  [
    'VFA',
    'FVWN',
    'Victoria Falls Airport',
    'Victoria Falls',
    'Zimbabwe',
    'ZW',
    'Africa/Harare',
    -18.0956,
    25.839,
    'africa',
  ],
  [
    'LUN',
    'FLKI',
    'Kenneth Kaunda International Airport',
    'Lusaka',
    'Zambia',
    'ZM',
    'Africa/Lusaka',
    -15.3308,
    28.4526,
    'africa',
  ],
  [
    'MPM',
    'FQMA',
    'Maputo International Airport',
    'Maputo',
    'Mozambique',
    'MZ',
    'Africa/Maputo',
    -26.4345,
    32.5732,
    'africa',
  ],
  [
    'ABV',
    'DNAA',
    'Nnamdi Azikiwe International Airport',
    'Abuja',
    'Nigeria',
    'NG',
    'Africa/Lagos',
    9.0068,
    7.2632,
    'africa',
  ],
  [
    'ACC',
    'DGAA',
    'Kotoka International Airport',
    'Accra',
    'Ghana',
    'GH',
    'Africa/Accra',
    5.6052,
    -0.1668,
    'africa',
  ],
  [
    'ABJ',
    'DIAP',
    'Félix Houphouët-Boigny International Airport',
    'Abidjan',
    "Côte d'Ivoire",
    'CI',
    'Africa/Abidjan',
    5.2614,
    -3.9263,
    'africa',
  ],
  [
    'DKR',
    'GOBD',
    'Blaise Diagne International Airport',
    'Dakar',
    'Senegal',
    'SN',
    'Africa/Dakar',
    14.671,
    -17.0732,
    'africa',
  ],
  [
    'CMN',
    'GMMN',
    'Mohammed V International Airport',
    'Casablanca',
    'Morocco',
    'MA',
    'Africa/Casablanca',
    33.3675,
    -7.59,
    'africa',
  ],
  [
    'TUN',
    'DTTA',
    'Tunis–Carthage International Airport',
    'Tunis',
    'Tunisia',
    'TN',
    'Africa/Tunis',
    36.851,
    10.2272,
    'africa',
  ],
  [
    'ALG',
    'DAAG',
    'Houari Boumediene Airport',
    'Algiers',
    'Algeria',
    'DZ',
    'Africa/Algiers',
    36.691,
    3.2154,
    'africa',
  ],
  [
    'KRT',
    'HSSS',
    'Khartoum International Airport',
    'Khartoum',
    'Sudan',
    'SD',
    'Africa/Khartoum',
    15.5895,
    32.5532,
    'africa',
  ],
  [
    'JIB',
    'HDMJ',
    'Djibouti–Ambouli International Airport',
    'Djibouti',
    'Djibouti',
    'DJ',
    'Africa/Djibouti',
    11.5473,
    43.1594,
    'africa',
  ],
  [
    'MRU',
    'FIMP',
    'Sir Seewoosagur Ramgoolam International Airport',
    'Mauritius',
    'Mauritius',
    'MU',
    'Indian/Mauritius',
    -20.4302,
    57.6836,
    'africa',
  ],
  [
    'SEZ',
    'FSIA',
    'Seychelles International Airport',
    'Mahé',
    'Seychelles',
    'SC',
    'Indian/Mahe',
    -4.6743,
    55.5217,
    'africa',
  ],
  [
    'TNR',
    'FMMI',
    'Ivato International Airport',
    'Antananarivo',
    'Madagascar',
    'MG',
    'Indian/Antananarivo',
    -18.7969,
    47.4788,
    'africa',
  ],
  [
    'FIH',
    'FZAA',
    "N'Djili International Airport",
    'Kinshasa',
    'Democratic Republic of the Congo',
    'CD',
    'Africa/Kinshasa',
    -4.3857,
    15.4446,
    'africa',
  ],
  [
    'LAD',
    'FNLU',
    'Quatro de Fevereiro International Airport',
    'Luanda',
    'Angola',
    'AO',
    'Africa/Luanda',
    -8.8584,
    13.2312,
    'africa',
  ],
  [
    'RUN',
    'FMEE',
    'Roland Garros Airport',
    'Réunion',
    'Réunion',
    'RE',
    'Indian/Reunion',
    -20.8909,
    55.5151,
    'africa',
  ],
  // ── Europe ──
  [
    'MXP',
    'LIMC',
    'Milan Malpensa Airport',
    'Milan',
    'Italy',
    'IT',
    'Europe/Rome',
    45.6306,
    8.7281,
    'europe',
  ],
  [
    'FCO',
    'LIRF',
    'Leonardo da Vinci–Fiumicino Airport',
    'Rome',
    'Italy',
    'IT',
    'Europe/Rome',
    41.8003,
    12.2389,
    'europe',
  ],
  [
    'ZRH',
    'LSZH',
    'Zurich Airport',
    'Zurich',
    'Switzerland',
    'CH',
    'Europe/Zurich',
    47.4647,
    8.5492,
    'europe',
  ],
  [
    'VIE',
    'LOWW',
    'Vienna International Airport',
    'Vienna',
    'Austria',
    'AT',
    'Europe/Vienna',
    48.1103,
    16.5697,
    'europe',
  ],
  [
    'CPH',
    'EKCH',
    'Copenhagen Airport',
    'Copenhagen',
    'Denmark',
    'DK',
    'Europe/Copenhagen',
    55.618,
    12.656,
    'europe',
  ],
  [
    'ARN',
    'ESSA',
    'Stockholm Arlanda Airport',
    'Stockholm',
    'Sweden',
    'SE',
    'Europe/Stockholm',
    59.6519,
    17.9186,
    'europe',
  ],
  [
    'OSL',
    'ENGM',
    'Oslo Airport, Gardermoen',
    'Oslo',
    'Norway',
    'NO',
    'Europe/Oslo',
    60.1939,
    11.1004,
    'europe',
  ],
  [
    'HEL',
    'EFHK',
    'Helsinki-Vantaa Airport',
    'Helsinki',
    'Finland',
    'FI',
    'Europe/Helsinki',
    60.3172,
    24.9633,
    'europe',
  ],
  [
    'DUB',
    'EIDW',
    'Dublin Airport',
    'Dublin',
    'Ireland',
    'IE',
    'Europe/Dublin',
    53.4213,
    -6.2701,
    'europe',
  ],
  [
    'LIS',
    'LPPT',
    'Humberto Delgado Airport',
    'Lisbon',
    'Portugal',
    'PT',
    'Europe/Lisbon',
    38.7742,
    -9.1342,
    'europe',
  ],
  [
    'ATH',
    'LGAV',
    'Athens International Airport',
    'Athens',
    'Greece',
    'GR',
    'Europe/Athens',
    37.9364,
    23.9445,
    'europe',
  ],
  [
    'WAW',
    'EPWA',
    'Warsaw Chopin Airport',
    'Warsaw',
    'Poland',
    'PL',
    'Europe/Warsaw',
    52.1657,
    20.9671,
    'europe',
  ],
  [
    'BRU',
    'EBBR',
    'Brussels Airport',
    'Brussels',
    'Belgium',
    'BE',
    'Europe/Brussels',
    50.9014,
    4.4844,
    'europe',
  ],
  [
    'BER',
    'EDDB',
    'Berlin Brandenburg Airport',
    'Berlin',
    'Germany',
    'DE',
    'Europe/Berlin',
    52.3667,
    13.5033,
    'europe',
  ],
  [
    'MAN',
    'EGCC',
    'Manchester Airport',
    'Manchester',
    'United Kingdom',
    'GB',
    'Europe/London',
    53.3537,
    -2.275,
    'europe',
  ],
  // ── Middle East ──
  [
    'JED',
    'OEJN',
    'King Abdulaziz International Airport',
    'Jeddah',
    'Saudi Arabia',
    'SA',
    'Asia/Riyadh',
    21.6796,
    39.1565,
    'asia',
  ],
  [
    'KWI',
    'OKKK',
    'Kuwait International Airport',
    'Kuwait City',
    'Kuwait',
    'KW',
    'Asia/Kuwait',
    29.2266,
    47.9689,
    'asia',
  ],
  [
    'AUH',
    'OMAA',
    'Zayed International Airport',
    'Abu Dhabi',
    'United Arab Emirates',
    'AE',
    'Asia/Dubai',
    24.433,
    54.6511,
    'asia',
  ],
  [
    'MCT',
    'OOMS',
    'Muscat International Airport',
    'Muscat',
    'Oman',
    'OM',
    'Asia/Muscat',
    23.5933,
    58.2844,
    'asia',
  ],
  [
    'BEY',
    'OLBA',
    'Beirut–Rafic Hariri International Airport',
    'Beirut',
    'Lebanon',
    'LB',
    'Asia/Beirut',
    33.8208,
    35.4884,
    'asia',
  ],
  [
    'AMM',
    'OJAI',
    'Queen Alia International Airport',
    'Amman',
    'Jordan',
    'JO',
    'Asia/Amman',
    31.7226,
    35.9932,
    'asia',
  ],
  // ── Asia ──
  [
    'KUL',
    'WMKK',
    'Kuala Lumpur International Airport',
    'Kuala Lumpur',
    'Malaysia',
    'MY',
    'Asia/Kuala_Lumpur',
    2.7456,
    101.7099,
    'asia',
  ],
  [
    'BKK',
    'VTBS',
    'Suvarnabhumi Airport',
    'Bangkok',
    'Thailand',
    'TH',
    'Asia/Bangkok',
    13.69,
    100.7501,
    'asia',
  ],
  [
    'CGK',
    'WIII',
    'Soekarno–Hatta International Airport',
    'Jakarta',
    'Indonesia',
    'ID',
    'Asia/Jakarta',
    -6.1256,
    106.6558,
    'asia',
  ],
  [
    'PEK',
    'ZBAA',
    'Beijing Capital International Airport',
    'Beijing',
    'China',
    'CN',
    'Asia/Shanghai',
    40.0799,
    116.6031,
    'asia',
  ],
  [
    'PVG',
    'ZSPD',
    'Shanghai Pudong International Airport',
    'Shanghai',
    'China',
    'CN',
    'Asia/Shanghai',
    31.1443,
    121.8083,
    'asia',
  ],
  [
    'ICN',
    'RKSI',
    'Incheon International Airport',
    'Seoul',
    'South Korea',
    'KR',
    'Asia/Seoul',
    37.4602,
    126.4407,
    'asia',
  ],
  [
    'MNL',
    'RPLL',
    'Ninoy Aquino International Airport',
    'Manila',
    'Philippines',
    'PH',
    'Asia/Manila',
    14.5086,
    121.0194,
    'asia',
  ],
  [
    'SGN',
    'VVTS',
    'Tan Son Nhat International Airport',
    'Ho Chi Minh City',
    'Vietnam',
    'VN',
    'Asia/Ho_Chi_Minh',
    10.8188,
    106.6519,
    'asia',
  ],
  [
    'HAN',
    'VVNB',
    'Noi Bai International Airport',
    'Hanoi',
    'Vietnam',
    'VN',
    'Asia/Ho_Chi_Minh',
    21.2212,
    105.8072,
    'asia',
  ],
  [
    'TPE',
    'RCTP',
    'Taiwan Taoyuan International Airport',
    'Taipei',
    'Taiwan',
    'TW',
    'Asia/Taipei',
    25.0777,
    121.2328,
    'asia',
  ],
  [
    'CMB',
    'VCBI',
    'Bandaranaike International Airport',
    'Colombo',
    'Sri Lanka',
    'LK',
    'Asia/Colombo',
    7.1808,
    79.8841,
    'asia',
  ],
  [
    'DAC',
    'VGHS',
    'Hazrat Shahjalal International Airport',
    'Dhaka',
    'Bangladesh',
    'BD',
    'Asia/Dhaka',
    23.8433,
    90.3978,
    'asia',
  ],
  [
    'KTM',
    'VNKT',
    'Tribhuvan International Airport',
    'Kathmandu',
    'Nepal',
    'NP',
    'Asia/Kathmandu',
    27.6966,
    85.3591,
    'asia',
  ],
  // ── North America ──
  [
    'LAX',
    'KLAX',
    'Los Angeles International Airport',
    'Los Angeles',
    'United States',
    'US',
    'America/Los_Angeles',
    33.9416,
    -118.4085,
    'north-america',
  ],
  [
    'SFO',
    'KSFO',
    'San Francisco International Airport',
    'San Francisco',
    'United States',
    'US',
    'America/Los_Angeles',
    37.6213,
    -122.379,
    'north-america',
  ],
  [
    'ORD',
    'KORD',
    "O'Hare International Airport",
    'Chicago',
    'United States',
    'US',
    'America/Chicago',
    41.9742,
    -87.9073,
    'north-america',
  ],
  [
    'ATL',
    'KATL',
    'Hartsfield–Jackson Atlanta International Airport',
    'Atlanta',
    'United States',
    'US',
    'America/New_York',
    33.6407,
    -84.4277,
    'north-america',
  ],
  [
    'MIA',
    'KMIA',
    'Miami International Airport',
    'Miami',
    'United States',
    'US',
    'America/New_York',
    25.7959,
    -80.287,
    'north-america',
  ],
  [
    'DFW',
    'KDFW',
    'Dallas/Fort Worth International Airport',
    'Dallas',
    'United States',
    'US',
    'America/Chicago',
    32.8998,
    -97.0403,
    'north-america',
  ],
  [
    'SEA',
    'KSEA',
    'Seattle–Tacoma International Airport',
    'Seattle',
    'United States',
    'US',
    'America/Los_Angeles',
    47.4502,
    -122.3088,
    'north-america',
  ],
  [
    'BOS',
    'KBOS',
    'Logan International Airport',
    'Boston',
    'United States',
    'US',
    'America/New_York',
    42.3656,
    -71.0096,
    'north-america',
  ],
  [
    'IAD',
    'KIAD',
    'Washington Dulles International Airport',
    'Washington',
    'United States',
    'US',
    'America/New_York',
    38.9531,
    -77.4565,
    'north-america',
  ],
  [
    'YVR',
    'CYVR',
    'Vancouver International Airport',
    'Vancouver',
    'Canada',
    'CA',
    'America/Vancouver',
    49.1967,
    -123.1815,
    'north-america',
  ],
  [
    'MEX',
    'MMMX',
    'Mexico City International Airport',
    'Mexico City',
    'Mexico',
    'MX',
    'America/Mexico_City',
    19.4363,
    -99.0721,
    'north-america',
  ],
  // ── South America ──
  [
    'EZE',
    'SAEZ',
    'Ministro Pistarini International Airport',
    'Buenos Aires',
    'Argentina',
    'AR',
    'America/Argentina/Buenos_Aires',
    -34.8222,
    -58.5358,
    'south-america',
  ],
  [
    'SCL',
    'SCEL',
    'Arturo Merino Benítez International Airport',
    'Santiago',
    'Chile',
    'CL',
    'America/Santiago',
    -33.393,
    -70.7858,
    'south-america',
  ],
  [
    'BOG',
    'SKBO',
    'El Dorado International Airport',
    'Bogotá',
    'Colombia',
    'CO',
    'America/Bogota',
    4.7016,
    -74.1469,
    'south-america',
  ],
  [
    'LIM',
    'SPJC',
    'Jorge Chávez International Airport',
    'Lima',
    'Peru',
    'PE',
    'America/Lima',
    -12.0219,
    -77.1143,
    'south-america',
  ],
  [
    'GIG',
    'SBGL',
    'Rio de Janeiro/Galeão International Airport',
    'Rio de Janeiro',
    'Brazil',
    'BR',
    'America/Sao_Paulo',
    -22.81,
    -43.2506,
    'south-america',
  ],
  [
    'UIO',
    'SEQM',
    'Mariscal Sucre International Airport',
    'Quito',
    'Ecuador',
    'EC',
    'America/Guayaquil',
    -0.1292,
    -78.3575,
    'south-america',
  ],
  // ── Oceania ──
  [
    'BNE',
    'YBBN',
    'Brisbane Airport',
    'Brisbane',
    'Australia',
    'AU',
    'Australia/Brisbane',
    -27.3842,
    153.1175,
    'oceania',
  ],
  [
    'AKL',
    'NZAA',
    'Auckland Airport',
    'Auckland',
    'New Zealand',
    'NZ',
    'Pacific/Auckland',
    -37.0082,
    174.785,
    'oceania',
  ],
  [
    'PER',
    'YPPH',
    'Perth Airport',
    'Perth',
    'Australia',
    'AU',
    'Australia/Perth',
    -31.9403,
    115.9669,
    'oceania',
  ],
  [
    'NAN',
    'NFFN',
    'Nadi International Airport',
    'Nadi',
    'Fiji',
    'FJ',
    'Pacific/Fiji',
    -17.7554,
    177.4434,
    'oceania',
  ],
  // ── Antarctica (real research-station airfields) ──
  [
    'TNM',
    'SCRM',
    'Teniente Rodolfo Marsh Martin Airport',
    'Villa Las Estrellas',
    'Antarctica',
    'AQ',
    'America/Punta_Arenas',
    -62.1908,
    -58.9867,
    'antarctica',
  ],
  [
    'UGL',
    'SCGC',
    'Union Glacier Blue-Ice Runway',
    'Union Glacier',
    'Antarctica',
    'AQ',
    'Antarctica/McMurdo',
    -79.7778,
    -83.3208,
    'antarctica',
  ],
  [
    'WFL',
    'NZWD',
    'Williams Field',
    'McMurdo Sound',
    'Antarctica',
    'AQ',
    'Antarctica/McMurdo',
    -77.8674,
    167.057,
    'antarctica',
  ],
  [
    'SPL',
    'NZSP',
    'Amundsen–Scott South Pole Station Airport',
    'South Pole',
    'Antarctica',
    'AQ',
    'Antarctica/McMurdo',
    -89.9975,
    139.2728,
    'antarctica',
  ],
];

const NETWORK_AIRPORTS: SeedAirport[] = WORLD_NETWORK.map(
  ([code, icao, name, city, country, countryCode, timezone, latitude, longitude, continent]) => ({
    code,
    icao,
    name,
    city,
    country,
    countryCode,
    timezone,
    latitude,
    longitude,
    continent,
    region: 'INTERNATIONAL' as RouteType,
    domestic: false,
  }),
);

/** Every airport the airline serves, with continents attached. */
const ALL_AIRPORTS: SeedAirport[] = [
  ...AIRPORTS.map((a) => ({ ...a, continent: LEGACY_CONTINENT[a.code] })),
  ...NETWORK_AIRPORTS,
];

// ───────────────────────────── fleet & seat maps ─────────────────────────────
interface SeatSpec {
  label: string;
  row: number;
  letter: string;
  cabin: CabinClass;
  zone: 'STANDARD' | 'EXIT_ROW' | 'BULKHEAD' | 'FRONT' | 'REAR';
  extraFeeMinor: number;
}

function buildE190Seats(): SeatSpec[] {
  const seats: SeatSpec[] = [];
  const letters = ['A', 'B', 'C', 'D'];
  for (let row = 1; row <= 24; row += 1) {
    for (const letter of letters) {
      const zone =
        row <= 2
          ? 'FRONT'
          : row >= 23
            ? 'REAR'
            : row === 12 || row === 13
              ? 'EXIT_ROW'
              : 'STANDARD';
      const fee = zone === 'FRONT' ? 150_000 : zone === 'EXIT_ROW' ? 250_000 : 0; // KES 1,500 / 2,500
      seats.push({
        label: `${row}${letter}`,
        row,
        letter,
        cabin: 'ECONOMY',
        zone,
        extraFeeMinor: fee,
      });
    }
  }
  return seats;
}

function buildB738Seats(): SeatSpec[] {
  const seats: SeatSpec[] = [];
  for (let row = 1; row <= 4; row += 1) {
    for (const letter of ['A', 'B', 'D', 'E']) {
      seats.push({
        label: `${row}${letter}`,
        row,
        letter,
        cabin: 'BUSINESS',
        zone: 'FRONT',
        extraFeeMinor: 0,
      });
    }
  }
  for (let row = 5; row <= 30; row += 1) {
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const zone =
        row <= 6
          ? 'FRONT'
          : row === 12 || row === 13
            ? 'EXIT_ROW'
            : row >= 29
              ? 'REAR'
              : 'STANDARD';
      const fee = zone === 'FRONT' ? 200_000 : zone === 'EXIT_ROW' ? 300_000 : 0; // KES 2,000 / 3,000
      seats.push({
        label: `${row}${letter}`,
        row,
        letter,
        cabin: 'ECONOMY',
        zone,
        extraFeeMinor: fee,
      });
    }
  }
  return seats;
}

function buildB789Seats(): SeatSpec[] {
  const seats: SeatSpec[] = [];
  // Business: 2-2 up front (rows 1–6)
  for (let row = 1; row <= 6; row += 1) {
    for (const letter of ['A', 'C', 'D', 'F']) {
      seats.push({
        label: `${row}${letter}`,
        row,
        letter,
        cabin: 'BUSINESS',
        zone: row <= 2 ? 'FRONT' : 'STANDARD',
        extraFeeMinor: 0,
      });
    }
  }
  // Economy: 3-3-3 (rows 7–34)
  for (let row = 7; row <= 34; row += 1) {
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J']) {
      const zone =
        row <= 8
          ? 'FRONT'
          : row === 14 || row === 15
            ? 'EXIT_ROW'
            : row >= 33
              ? 'REAR'
              : 'STANDARD';
      const fee = zone === 'FRONT' ? 200_000 : zone === 'EXIT_ROW' ? 300_000 : 0; // KES 2,000 / 3,000
      seats.push({
        label: `${row}${letter}`,
        row,
        letter,
        cabin: 'ECONOMY',
        zone,
        extraFeeMinor: fee,
      });
    }
  }
  return seats;
}

const AIRCRAFT_TYPES = [
  {
    code: 'E190',
    name: 'Embraer E190',
    manufacturer: 'Embraer',
    rangeKm: 4500,
    cruiseKts: 470,
    co2GramsPerPaxKm: 102, // regional jet — higher per-seat burn on short sectors
    buildSeats: buildE190Seats,
  },
  {
    code: 'B738',
    name: 'Boeing 737-800',
    manufacturer: 'Boeing',
    rangeKm: 5700,
    cruiseKts: 460,
    co2GramsPerPaxKm: 95, // narrowbody workhorse
    buildSeats: buildB738Seats,
  },
  {
    code: 'B789',
    name: 'Boeing 787-9 Dreamliner',
    manufacturer: 'Boeing',
    rangeKm: 14140,
    cruiseKts: 490,
    co2GramsPerPaxKm: 74, // composite widebody — lowest per-seat burn, long sectors
    buildSeats: buildB789Seats,
  },
] as const;

const AIRCRAFT = [
  { registration: '5Y-KAA', type: 'E190' },
  { registration: '5Y-KAB', type: 'E190' },
  { registration: '5Y-KAC', type: 'E190' },
  { registration: '5Y-KBB', type: 'B738' },
  { registration: '5Y-KBC', type: 'B738' },
  { registration: '5Y-KDA', type: 'B789' },
  { registration: '5Y-KDB', type: 'B789' },
  { registration: '5Y-KDC', type: 'B789' },
];

// ───────────────────────────── fares ─────────────────────────────
const FARE_CLASSES = [
  {
    code: 'SAVER',
    name: 'Saver',
    cabin: 'ECONOMY' as CabinClass,
    baggageKg: 20,
    carryOnKg: 7,
    changesAllowed: false,
    refundable: false,
    sortOrder: 10,
    multiplier: 1.0,
  },
  {
    code: 'CLASSIC',
    name: 'Classic',
    cabin: 'ECONOMY' as CabinClass,
    baggageKg: 23,
    carryOnKg: 10,
    changesAllowed: true,
    refundable: false,
    sortOrder: 20,
    multiplier: 1.25,
  },
  {
    code: 'FLEX',
    name: 'Flex',
    cabin: 'ECONOMY' as CabinClass,
    baggageKg: 30,
    carryOnKg: 10,
    changesAllowed: true,
    refundable: true,
    sortOrder: 30,
    multiplier: 1.6,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    cabin: 'BUSINESS' as CabinClass,
    baggageKg: 40,
    carryOnKg: 15,
    changesAllowed: true,
    refundable: true,
    sortOrder: 40,
    multiplier: 2.4,
  },
];

interface FareRuleSpec {
  fareClass: string;
  routeType: RouteType;
  changeAllowed: boolean;
  changeFeeMinor: number;
  cancelAllowed: boolean;
  cancelFeePercentBps: number;
  noShowFeeMinor: number;
  textEn: string;
  textSw: string;
}

const FARE_RULES: FareRuleSpec[] = [
  // ── domestic ──
  {
    fareClass: 'SAVER',
    routeType: 'DOMESTIC',
    changeAllowed: false,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 2500,
    noShowFeeMinor: 100_000,
    textEn:
      'Changes not permitted. Cancellation 7+ days before departure: 25% fee. Within 7 days or no-show: non-refundable.',
    textSw:
      'Mabadiliko hayaruhusiwi. Kufuta siku 7+ kabla ya safari: ada ya 25%. Siku chini ya 7 au usioweza kuhudhuria: hazirudishwi.',
  },
  {
    fareClass: 'CLASSIC',
    routeType: 'DOMESTIC',
    changeAllowed: true,
    changeFeeMinor: 500_000,
    cancelAllowed: true,
    cancelFeePercentBps: 1000,
    noShowFeeMinor: 100_000,
    textEn:
      'One free change. Further changes KES 5,000. Cancellation 7+ days before departure: 10% fee; within 7 days: 25% fee.',
    textSw:
      'Mabadiliko moja bila malipo. Zaidi ya moja KES 5,000. Kufuta siku 7+ kabla: ada ya 10%; ndani ya siku 7: ada ya 25%.',
  },
  {
    fareClass: 'FLEX',
    routeType: 'DOMESTIC',
    changeAllowed: true,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 0,
    noShowFeeMinor: 0,
    textEn:
      'Free changes any time up to 2 hours before departure. Fully refundable to original payment method.',
    textSw:
      'Mabadiliko bila malipo hadi saa 2 kabla ya safari. Inarudishwa kikamilifu kwenye njia ya malipo ya awali.',
  },
  {
    fareClass: 'BUSINESS',
    routeType: 'DOMESTIC',
    changeAllowed: true,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 0,
    noShowFeeMinor: 0,
    textEn: 'Fully flexible and refundable.',
    textSw: 'Rafiki kabisa na inarudishwa.',
  },
  // ── international ──
  {
    fareClass: 'SAVER',
    routeType: 'INTERNATIONAL',
    changeAllowed: false,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 4000,
    noShowFeeMinor: 200_000,
    textEn:
      'Changes not permitted. Cancellation 14+ days before departure: 40% fee. Within 14 days or no-show: non-refundable. Name changes not permitted.',
    textSw:
      'Mabadiliko hayaruhusiwi. Kufuta siku 14+ kabla: ada ya 40%. Ndani ya siku 14 au usioweza kuhudhuria: hazirudishwi.',
  },
  {
    fareClass: 'CLASSIC',
    routeType: 'INTERNATIONAL',
    changeAllowed: true,
    changeFeeMinor: 1000_000,
    cancelAllowed: true,
    cancelFeePercentBps: 2000,
    noShowFeeMinor: 200_000,
    textEn:
      'Changes permitted with KES 10,000 fee. Cancellation 14+ days before departure: 20% fee; within 14 days: 40% fee.',
    textSw:
      'Mabadiliko yanaruhusiwa kwa ada ya KES 10,000. Kufuta siku 14+ kabla: ada ya 20%; ndani ya siku 14: 40%.',
  },
  {
    fareClass: 'FLEX',
    routeType: 'INTERNATIONAL',
    changeAllowed: true,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 500,
    noShowFeeMinor: 200_000,
    textEn:
      'Free changes subject to fare difference. Cancellation 14+ days before departure: 5% fee; within 14 days: 20% fee.',
    textSw:
      'Mabadiliko bila ada kulingana na tofauti ya nauli. Kufuta siku 14+ kabla: ada ya 5%; ndani ya siku 14: 20%.',
  },
  {
    fareClass: 'BUSINESS',
    routeType: 'INTERNATIONAL',
    changeAllowed: true,
    changeFeeMinor: 0,
    cancelAllowed: true,
    cancelFeePercentBps: 0,
    noShowFeeMinor: 0,
    textEn: 'Fully flexible and refundable, including no-shows.',
    textSw: 'Rafiki kabisa na inarudishwa, hata usioweza kuhudhuria.',
  },
];

/**
 * TAX/FEE PLACEHOLDERS — Finance must confirm every rate, code and reference
 * against the current KAA/KCAA schedule before go-live (see INTEGRATION_CHECKLIST).
 */
const TAX_RULES: Array<Omit<Prisma.TaxFeeRuleUncheckedCreateInput, 'id' | 'createdAt'>> = [
  {
    code: 'VAT',
    name: 'Value Added Tax (domestic)',
    routeType: 'DOMESTIC',
    calcType: 'PERCENT',
    percentBps: 1600,
    appliesTo: 'BASE_FARE',
    sortOrder: 10,
    reference: 'PLACEHOLDER — Kenya VAT Act rate 16% — FINANCE TO CONFIRM',
  },
  {
    code: 'VAT',
    name: 'Value Added Tax (international)',
    routeType: 'INTERNATIONAL',
    calcType: 'PERCENT',
    percentBps: 0,
    appliesTo: 'BASE_FARE',
    sortOrder: 10,
    reference: 'PLACEHOLDER — international carriage typically zero-rated — FINANCE TO CONFIRM',
  },
  {
    code: 'PSC',
    name: 'Passenger Service Charge (domestic)',
    routeType: 'DOMESTIC',
    calcType: 'FLAT',
    flatMinor: 50_000,
    appliesTo: 'TOTAL',
    sortOrder: 20,
    reference: 'PLACEHOLDER — KES 500 per passenger — FINANCE TO CONFIRM',
  },
  {
    code: 'PSC',
    name: 'Passenger Service Charge (international)',
    routeType: 'INTERNATIONAL',
    calcType: 'FLAT',
    flatMinor: 200_000,
    appliesTo: 'TOTAL',
    sortOrder: 20,
    reference: 'PLACEHOLDER — KES 2,000 per passenger — FINANCE TO CONFIRM',
  },
  {
    code: 'ASC',
    name: 'Airport Service Charge (domestic)',
    routeType: 'DOMESTIC',
    calcType: 'FLAT',
    flatMinor: 10_000,
    appliesTo: 'TOTAL',
    sortOrder: 30,
    reference: 'PLACEHOLDER — KES 100 per passenger — FINANCE TO CONFIRM',
  },
  {
    code: 'ASC',
    name: 'Airport Service Charge (international)',
    routeType: 'INTERNATIONAL',
    calcType: 'FLAT',
    flatMinor: 50_000,
    appliesTo: 'TOTAL',
    sortOrder: 30,
    reference: 'PLACEHOLDER — KES 500 per passenger — FINANCE TO CONFIRM',
  },
  {
    code: 'FUEL',
    name: 'Fuel Surcharge (domestic)',
    routeType: 'DOMESTIC',
    calcType: 'PERCENT',
    percentBps: 500,
    appliesTo: 'BASE_FARE',
    sortOrder: 40,
    reference: 'PLACEHOLDER — 5% of base fare — FINANCE TO CONFIRM',
  },
  {
    code: 'FUEL',
    name: 'Fuel Surcharge (international)',
    routeType: 'INTERNATIONAL',
    calcType: 'PERCENT',
    percentBps: 800,
    appliesTo: 'BASE_FARE',
    sortOrder: 40,
    reference: 'PLACEHOLDER — 8% of base fare — FINANCE TO CONFIRM',
  },
];

// ───────────────────────────── schedules ─────────────────────────────
interface ScheduleSpec {
  flightNumber: string;
  origin: string;
  destination: string;
  departMin: number;
  durationMin: number;
  days: number[]; // 0=Sun…6=Sat
  aircraft: string;
  baseFareMinor: number; // SAVER base, whole shillings
  routeType: RouteType;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const SCHEDULES: ScheduleSpec[] = [
  // domestic E190
  {
    flightNumber: 'F13101',
    origin: 'NBO',
    destination: 'MBA',
    departMin: clock(7 * 60),
    durationMin: 60,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 850_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13102',
    origin: 'MBA',
    destination: 'NBO',
    departMin: clock(17 * 60),
    durationMin: 60,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 850_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13103',
    origin: 'NBO',
    destination: 'KIS',
    departMin: clock(9 * 60),
    durationMin: 55,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 750_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13104',
    origin: 'KIS',
    destination: 'NBO',
    departMin: clock(18 * 60),
    durationMin: 55,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 750_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13105',
    origin: 'NBO',
    destination: 'EDL',
    departMin: clock(7 * 60 + 30),
    durationMin: 50,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 780_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13106',
    origin: 'EDL',
    destination: 'NBO',
    departMin: clock(17 * 60 + 30),
    durationMin: 50,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 780_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13107',
    origin: 'NBO',
    destination: 'MYD',
    departMin: clock(10 * 60),
    durationMin: 70,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 950_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13108',
    origin: 'MYD',
    destination: 'NBO',
    departMin: clock(19 * 60),
    durationMin: 70,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 950_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13109',
    origin: 'NBO',
    destination: 'LAU',
    departMin: clock(8 * 60),
    durationMin: 80,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 950_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13110',
    origin: 'LAU',
    destination: 'NBO',
    departMin: clock(17 * 60),
    durationMin: 80,
    days: ALL_DAYS,
    aircraft: 'E190',
    baseFareMinor: 950_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13111',
    origin: 'WIL',
    destination: 'MBA',
    departMin: clock(8 * 60),
    durationMin: 60,
    days: [1, 3, 5],
    aircraft: 'E190',
    baseFareMinor: 900_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13112',
    origin: 'MBA',
    destination: 'WIL',
    departMin: clock(16 * 60),
    durationMin: 60,
    days: [1, 3, 5],
    aircraft: 'E190',
    baseFareMinor: 900_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13113',
    origin: 'WIL',
    destination: 'KIS',
    departMin: clock(7 * 60),
    durationMin: 45,
    days: [1, 2, 3, 4, 5],
    aircraft: 'E190',
    baseFareMinor: 700_000,
    routeType: 'DOMESTIC',
  },
  {
    flightNumber: 'F13114',
    origin: 'KIS',
    destination: 'WIL',
    departMin: clock(19 * 60),
    durationMin: 45,
    days: [1, 2, 3, 4, 5],
    aircraft: 'E190',
    baseFareMinor: 700_000,
    routeType: 'DOMESTIC',
  },
  // regional / international B738
  {
    flightNumber: 'F13201',
    origin: 'NBO',
    destination: 'EBB',
    departMin: clock(8 * 60 + 30),
    durationMin: 75,
    days: ALL_DAYS,
    aircraft: 'B738',
    baseFareMinor: 2_800_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13202',
    origin: 'EBB',
    destination: 'NBO',
    departMin: clock(12 * 60),
    durationMin: 75,
    days: ALL_DAYS,
    aircraft: 'B738',
    baseFareMinor: 2_800_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13203',
    origin: 'NBO',
    destination: 'DAR',
    departMin: clock(9 * 60),
    durationMin: 90,
    days: ALL_DAYS,
    aircraft: 'B738',
    baseFareMinor: 2_600_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13204',
    origin: 'DAR',
    destination: 'NBO',
    departMin: clock(13 * 60),
    durationMin: 90,
    days: ALL_DAYS,
    aircraft: 'B738',
    baseFareMinor: 2_600_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13205',
    origin: 'NBO',
    destination: 'JNB',
    departMin: clock(10 * 60),
    durationMin: 210,
    days: [1, 2, 4, 5],
    aircraft: 'B738',
    baseFareMinor: 4_500_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13206',
    origin: 'JNB',
    destination: 'NBO',
    departMin: clock(14 * 60),
    durationMin: 210,
    days: [1, 2, 4, 5],
    aircraft: 'B738',
    baseFareMinor: 4_500_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13207',
    origin: 'NBO',
    destination: 'DXB',
    departMin: clock(14 * 60),
    durationMin: 240,
    days: [0, 2, 4, 6],
    aircraft: 'B738',
    baseFareMinor: 5_200_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13208',
    origin: 'DXB',
    destination: 'NBO',
    departMin: clock(2 * 60 + 30),
    durationMin: 270,
    days: [1, 3, 5, 0],
    aircraft: 'B738',
    baseFareMinor: 5_200_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13209',
    origin: 'NBO',
    destination: 'LHR',
    departMin: clock(23 * 60),
    durationMin: 510,
    days: [1, 3, 5],
    aircraft: 'B738',
    baseFareMinor: 9_500_000,
    routeType: 'INTERNATIONAL',
  },
  {
    flightNumber: 'F13210',
    origin: 'LHR',
    destination: 'NBO',
    departMin: clock(21 * 60 + 30),
    durationMin: 540,
    days: [2, 4, 6],
    aircraft: 'B738',
    baseFareMinor: 9_500_000,
    routeType: 'INTERNATIONAL',
  },
];

// ─────────────── worldwide network — intercontinental schedules ───────────────
// Hub-and-spoke from NBO. Durations and fares are derived from the seeded
// coordinates (great-circle distance) rather than hand-typed, so every new
// route is self-consistent: block time = distance ÷ Dreamliner cruise + taxi,
// fare ≈ KES 14/km — the same rate the hand-written DXB/LHR sectors use.

const WORLD_AIRPORT_BY_CODE = new Map(ALL_AIRPORTS.map((a) => [a.code, a]));

function haversineKm(a: SeedAirport, b: SeedAirport): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function longHaul(
  flightNumber: string,
  originCode: string,
  destinationCode: string,
  departMin: number,
): ScheduleSpec {
  const origin = WORLD_AIRPORT_BY_CODE.get(originCode)!;
  const destination = WORLD_AIRPORT_BY_CODE.get(destinationCode)!;
  const km = haversineKm(origin, destination);
  const cruiseKmh = 490 * 1.852; // B789 cruise in km/h
  const taxiBuffer = km > 6000 ? 60 : 45;
  const durationMin = Math.round((km / cruiseKmh) * 60) + taxiBuffer;
  const baseFareMinor = Math.round((km * 1400) / 50_000) * 50_000; // ≈ KES 14/km
  return {
    flightNumber,
    origin: originCode,
    destination: destinationCode,
    departMin: clock(departMin),
    durationMin,
    days: ALL_DAYS,
    aircraft: 'B789',
    baseFareMinor,
    routeType: 'INTERNATIONAL',
  };
}

/**
 * Every station outside the Nairobi hub gets a daily return service —
 * departure times are spread deterministically across the day so the
 * timetable looks like a real hub network. [destination, NBO departure,
 * home-base departure] — local clock minutes.
 */
const WORLD_ROUTES: Array<[string, number, number]> = ALL_AIRPORTS.filter(
  (a) => a.code !== 'NBO' && !a.domestic,
).map((a, index) => [
  a.code,
  clock(6 * 60 + ((index * 41) % (16 * 60))),
  clock(8 * 60 + ((index * 53) % (13 * 60))),
]);

WORLD_ROUTES.forEach(([destination, outMin, homeMin], index) => {
  const outbound = 13401 + index * 2;
  const inbound = outbound + 1;
  SCHEDULES.push(
    longHaul(`F${outbound}`, 'NBO', destination, outMin),
    longHaul(`F${inbound}`, destination, 'NBO', homeMin),
  );
});

// ───────────────────────────── seed steps ─────────────────────────────
async function seedAirports(): Promise<void> {
  const seen = new Set<string>();
  for (const airport of ALL_AIRPORTS) {
    if (seen.has(airport.code)) throw new Error(`duplicate airport code ${airport.code}`);
    if (!airport.continent) throw new Error(`missing continent for ${airport.code}`);
    seen.add(airport.code);
    await prisma.airport.upsert({
      where: { code: airport.code },
      update: airport,
      create: airport,
    });
  }
  console.log(
    `✓ airports (${ALL_AIRPORTS.length} across ${new Set(ALL_AIRPORTS.map((a) => a.continent)).size} continents)`,
  );
}

async function seedFleet(): Promise<void> {
  for (const type of AIRCRAFT_TYPES) {
    const { buildSeats, ...data } = type;
    const aircraftType = await prisma.aircraftType.upsert({
      where: { code: data.code },
      update: data,
      create: data,
    });

    const seats = buildSeats();
    const seatMap = await prisma.seatMap.upsert({
      where: { aircraftTypeId: aircraftType.id },
      update: {
        name: `${data.code} layout`,
        layout: {
          rows: Math.max(...seats.map((s) => s.row)),
          lettersByCabin: {
            ECONOMY: [...new Set(seats.filter((s) => s.cabin === 'ECONOMY').map((s) => s.letter))],
            BUSINESS: [
              ...new Set(seats.filter((s) => s.cabin === 'BUSINESS').map((s) => s.letter)),
            ],
          },
          seatCount: seats.length,
        },
      },
      create: {
        aircraftTypeId: aircraftType.id,
        name: `${data.code} layout`,
        layout: {
          rows: Math.max(...seats.map((s) => s.row)),
          lettersByCabin: {
            ECONOMY: [...new Set(seats.filter((s) => s.cabin === 'ECONOMY').map((s) => s.letter))],
            BUSINESS: [
              ...new Set(seats.filter((s) => s.cabin === 'BUSINESS').map((s) => s.letter)),
            ],
          },
          seatCount: seats.length,
        },
      },
    });

    for (const seat of seats) {
      await prisma.seat.upsert({
        where: { seatMapId_label: { seatMapId: seatMap.id, label: seat.label } },
        update: seat,
        create: { ...seat, seatMapId: seatMap.id },
      });
    }
  }

  for (const aircraft of AIRCRAFT) {
    const type = await prisma.aircraftType.findUniqueOrThrow({ where: { code: aircraft.type } });
    await prisma.aircraft.upsert({
      where: { registration: aircraft.registration },
      update: { aircraftTypeId: type.id, status: 'ACTIVE' },
      create: {
        registration: aircraft.registration,
        aircraftTypeId: type.id,
        status: 'ACTIVE',
        deliveredAt: new Date(Date.UTC(2018, 0, 1)),
      },
    });
  }
  console.log(`✓ fleet (${AIRCRAFT_TYPES.length} types, ${AIRCRAFT.length} aircraft, seat maps)`);
}

async function seedFareClassesAndRules(): Promise<void> {
  for (const fc of FARE_CLASSES) {
    const { multiplier: _multiplier, ...data } = fc;
    await prisma.fareClass.upsert({ where: { code: data.code }, update: data, create: data });
  }
  for (const rule of FARE_RULES) {
    const fareClass = await prisma.fareClass.findUniqueOrThrow({ where: { code: rule.fareClass } });
    const { fareClass: _code, ...rest } = rule;
    await prisma.fareRule.upsert({
      where: { fareClassId_routeType: { fareClassId: fareClass.id, routeType: rule.routeType } },
      update: rest,
      create: { ...rest, fareClassId: fareClass.id },
    });
  }
  console.log(`✓ fare classes (${FARE_CLASSES.length}) + rules (${FARE_RULES.length})`);
}

async function seedTaxRules(): Promise<void> {
  const existing = await prisma.taxFeeRule.findFirst({
    where: { code: 'VAT', routeType: 'DOMESTIC' },
  });
  if (existing) {
    console.log('• tax rules already seeded (delete rows to re-create with new rates)');
    return;
  }
  for (const rule of TAX_RULES) {
    await prisma.taxFeeRule.create({ data: rule });
  }
  console.log(
    `⚠ tax/fee rules created — PLACEHOLDER RATES, finance must confirm (${TAX_RULES.length})`,
  );
}

async function seedSchedulesAndFlights(): Promise<void> {
  const airportByCode = new Map(ALL_AIRPORTS.map((a) => [a.code, a]));
  const effectiveFrom = utcDate(
    ...((): [number, number, number] => {
      const { y, m, d } = nairobiDate(-7);
      return [y, m, d];
    })(),
  );

  const scheduleIds = new Map<string, string>();

  for (const spec of SCHEDULES) {
    const type = await prisma.aircraftType.findUniqueOrThrow({ where: { code: spec.aircraft } });
    const data: Prisma.FlightScheduleUncheckedCreateInput = {
      flightNumber: spec.flightNumber,
      originCode: spec.origin,
      destinationCode: spec.destination,
      aircraftTypeId: type.id,
      departLocalMinutes: spec.departMin,
      durationMinutes: spec.durationMin,
      daysOfWeek: spec.days,
      routeType: spec.routeType,
      effectiveFrom,
      baseFareMinor: spec.baseFareMinor,
      saleStatus: 'OPEN',
    };
    const schedule = await prisma.flightSchedule.upsert({
      where: { id: `sched_${spec.flightNumber}` },
      update: data,
      create: { ...data, id: `sched_${spec.flightNumber}` },
    });
    scheduleIds.set(spec.flightNumber, schedule.id);
  }
  console.log(`✓ schedules (${SCHEDULES.length})`);

  const fareClassRows = await prisma.fareClass.findMany();
  const fareClassByCode = new Map(fareClassRows.map((fc) => [fc.code, fc]));
  const aircraftRows = await prisma.aircraft.findMany({ include: { aircraftType: true } });
  const aircraftByType = new Map<string, (typeof aircraftRows)[number][]>();
  for (const aircraft of aircraftRows) {
    // Keyed by the *type code* (E190/B738) — schedules reference codes, not ids.
    const list = aircraftByType.get(aircraft.aircraftType.code) ?? [];
    list.push(aircraft);
    aircraftByType.set(aircraft.aircraftType.code, list);
  }
  const seatCounts = new Map<string, { economy: number; business: number }>();
  for (const type of AIRCRAFT_TYPES) {
    const seats = type.buildSeats();
    seatCounts.set(type.code, {
      economy: seats.filter((s) => s.cabin === 'ECONOMY').length,
      business: seats.filter((s) => s.cabin === 'BUSINESS').length,
    });
  }

  let flightCount = 0;
  for (let dayOffset = -1; dayOffset <= 29; dayOffset += 1) {
    const { y, m, d } = nairobiDate(dayOffset);
    const weekday = weekdayOf(y, m, d);
    const flightDate = utcDate(y, m, d);

    for (const spec of SCHEDULES) {
      if (!spec.days.includes(weekday)) continue;
      const scheduleId = scheduleIds.get(spec.flightNumber)!;
      const origin = airportByCode.get(spec.origin)!;
      const scheduledDepUtc = zonedToUtc(y, m, d, spec.departMin, origin.timezone);
      const scheduledArrUtc = new Date(scheduledDepUtc.getTime() + spec.durationMin * 60_000);
      const type = AIRCRAFT_TYPES.find((t) => t.code === spec.aircraft)!;
      const fleet = aircraftByType.get(type.code) ?? [];
      const aircraft = fleet[flightCount % fleet.length];

      const flight = await prisma.flight.upsert({
        where: { scheduleId_flightDate: { scheduleId, flightDate } },
        update: {
          scheduledDepUtc,
          scheduledArrUtc,
          boardingUtc: new Date(scheduledDepUtc.getTime() - 45 * 60_000),
          aircraftId: aircraft?.id ?? null,
        },
        create: {
          scheduleId,
          flightDate,
          flightNumber: spec.flightNumber,
          originCode: spec.origin,
          destinationCode: spec.destination,
          routeType: spec.routeType,
          aircraftId: aircraft?.id ?? null,
          scheduledDepUtc,
          scheduledArrUtc,
          boardingUtc: new Date(scheduledDepUtc.getTime() - 45 * 60_000),
          status: 'SCHEDULED',
          currency: 'KES',
        },
      });

      // fares: economy classes on every aircraft, BUSINESS only where seats exist
      const counts = seatCounts.get(spec.aircraft)!;
      const applicable = FARE_CLASSES.filter((fc) =>
        fc.cabin === 'BUSINESS' ? counts.business > 0 : counts.economy > 0,
      );
      for (const fc of applicable) {
        const fareClass = fareClassByCode.get(fc.code)!;
        const baseFareMinor = Math.round((spec.baseFareMinor * fc.multiplier) / 100) * 100;
        await prisma.fare.upsert({
          where: { flightId_fareClassId: { flightId: flight.id, fareClassId: fareClass.id } },
          update: { baseFareMinor, saleStatus: 'OPEN' },
          create: {
            flightId: flight.id,
            fareClassId: fareClass.id,
            baseFareMinor,
            saleStatus: 'OPEN',
          },
        });

        let seatsTotal: number;
        if (fc.cabin === 'BUSINESS') {
          seatsTotal = counts.business;
        } else {
          const saver = Math.floor(counts.economy * 0.45);
          const classic = Math.floor(counts.economy * 0.35);
          const flex = counts.economy - saver - classic;
          seatsTotal = fc.code === 'SAVER' ? saver : fc.code === 'CLASSIC' ? classic : flex;
        }

        await prisma.inventory.upsert({
          where: { flightId_fareClassId: { flightId: flight.id, fareClassId: fareClass.id } },
          update: {},
          create: { flightId: flight.id, fareClassId: fareClass.id, seatsTotal },
        });
      }
      flightCount += 1;
    }
  }
  console.log(`✓ flights + fares + inventory (${flightCount} instances across 30 days)`);
}

interface SeedUser {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: Role;
  profile?: {
    dateOfBirth: string;
    nationality: string;
    countryOfResidence: string;
    docType: DocType;
    docNumber: string;
  };
}

const USERS: SeedUser[] = [
  {
    email: 'passenger@kenyaairways.example',
    phone: '+254712345678',
    firstName: 'Ani',
    lastName: 'Mwangi',
    role: 'PASSENGER',
    profile: {
      dateOfBirth: '1990-04-12',
      nationality: 'KE',
      countryOfResidence: 'KE',
      docType: 'ID',
      docNumber: '29011801',
    },
  },
  {
    email: 'j.kamau@kenyaairways.example',
    phone: '+254733111222',
    firstName: 'James',
    lastName: 'Kamau',
    role: 'PASSENGER',
    profile: {
      dateOfBirth: '1985-11-02',
      nationality: 'KE',
      countryOfResidence: 'KE',
      docType: 'PASSPORT',
      docNumber: 'A0034567',
    },
  },
  {
    email: 'agent@kenyaairways.example',
    phone: '+254720000002',
    firstName: 'Wanjiru',
    lastName: 'Njoroge',
    role: 'AGENT',
  },
  {
    email: 'ops@kenyaairways.example',
    phone: '+254720000003',
    firstName: 'Peter',
    lastName: 'Otieno',
    role: 'OPS',
  },
  {
    email: 'finance@kenyaairways.example',
    phone: '+254720000004',
    firstName: 'Grace',
    lastName: 'Wambui',
    role: 'FINANCE',
  },
  {
    email: 'admin@kenyaairways.example',
    phone: '+254720000005',
    firstName: 'Sys',
    lastName: 'Admin',
    role: 'ADMIN',
  },
];

async function seedUsers(): Promise<void> {
  const passwordHash = await bcrypt.hash(env.SEED_USER_PASSWORD, 10);
  const policyVersion = env.PRIVACY_POLICY_VERSION;

  for (const seed of USERS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: { role: seed.role, status: 'ACTIVE' },
      create: {
        email: seed.email,
        phone: seed.phone,
        firstName: seed.firstName,
        lastName: seed.lastName,
        role: seed.role,
        passwordHash,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });

    if (seed.profile) {
      await prisma.passengerProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          dateOfBirth: new Date(`${seed.profile.dateOfBirth}T00:00:00.000Z`),
          nationality: seed.profile.nationality,
          countryOfResidence: seed.profile.countryOfResidence,
          docType: seed.profile.docType,
          docNumberEncrypted: encryptField(seed.profile.docNumber, env.ENCRYPTION_KEY),
          docNumberHash: blindIndex(seed.profile.docNumber, env.ENCRYPTION_KEY),
        },
      });
    }

    for (const purpose of ['TERMS', 'PRIVACY'] as const) {
      const existing = await prisma.consentRecord.findFirst({
        where: { userId: user.id, purpose, revokedAt: null },
      });
      if (!existing) {
        await prisma.consentRecord.create({
          data: { userId: user.id, purpose, policyVersion, granted: true, source: 'seed' },
        });
      }
    }
  }
  console.log(`✓ users (${USERS.length}, one per role) — login with SEED_USER_PASSWORD from .env`);
}

// ─────────────────── manual M-Pesa paybill + site settings ──────────────────
/**
 * Paybill customers pay into BY HAND (no Daraja STK involved): the passenger
 * sends money to this number with their PNR as the account/reference, then
 * pastes the confirmation message while booking — it settles the payment on
 * the spot. Shown in the payment plan and in the passenger pay panel.
 */
const MPESA_PAYBILL = '0182774255';

/** Seed the paybill into the payment plan — never overwrites admin edits. */
async function seedPaymentPlan(): Promise<void> {
  const existing = await prisma.paymentMethodConfig.findUnique({
    where: { provider: 'MPESA_STK' },
  });
  if (existing) {
    console.log('• payment plan already configured — keeping admin overrides');
    return;
  }
  await prisma.paymentMethodConfig.create({
    data: {
      provider: 'MPESA_STK',
      enabled: true,
      settings: { shortcode: MPESA_PAYBILL },
    },
  });
  console.log(`✓ payment plan: M-Pesa paybill ${MPESA_PAYBILL} configured for MPESA_STK`);
}

/** Site appearance row (theme + admin-managed image URLs). Create-only. */
async function seedSiteSettings(): Promise<void> {
  const existing = await prisma.siteSettings.findUnique({ where: { id: true } });
  if (existing) {
    console.log('• site settings already seeded');
    return;
  }
  await prisma.siteSettings.create({ data: { theme: 'sky', appName: 'Kenya Airways.' } });
  console.log('✓ site settings (theme "sky", images fall back to web defaults)');
}

async function main(): Promise<void> {
  console.log('Seeding Kenya Airways …');
  await seedAirports();
  await seedFleet();
  await seedFareClassesAndRules();
  await seedTaxRules();
  await seedSchedulesAndFlights();
  await seedUsers();
  await seedPaymentPlan();
  await seedSiteSettings();
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
