/**
 * Admin offline-tools copy — English + Kiswahili, key-for-key parity.
 *
 * The parity spec (admin-messages.spec.ts) fails the build if a key exists
 * in one language but not the other, so the two dictionaries can never
 * drift apart.
 */

export type AdminLocale = 'en' | 'sw';

const en = {
  // shell
  offlineTools: 'Offline tools',
  console: 'Console',
  signedInAs: 'Signed in as {name}',
  signOut: 'Sign out',
  language: 'Language',
  // auth gate
  staffLogin: 'Staff sign-in',
  loginHint: 'Sign in with your airline account to use the offline tools.',
  identifier: 'Email or phone',
  password: 'Password',
  signIn: 'Sign in',
  loginFailed: 'Could not sign in',
  // tabs
  overview: 'Overview',
  flights: 'Flights',
  bookings: 'Bookings',
  payments: 'Payments',
  settings: 'Settings',
  // overview
  revenue30: 'Revenue · last 30 days',
  gross: 'Gross',
  net: 'Net',
  paymentsCount: 'Payments',
  load7: 'Load factor · next 7 days',
  flightsCount: 'Flights',
  seatsSold: 'Seats sold',
  capacity: 'Capacity',
  noData: 'Nothing to show yet',
  // flights
  flightsTitle: 'Flight prices',
  flightsHint: 'Tap a fare to change its base price (KES).',
  routeFilter: 'Origin code (e.g. NBO)',
  search: 'Search',
  basePrice: 'Base price',
  save: 'Save',
  saved: 'Price updated',
  saveFailed: 'Could not update the price',
  noFlights: 'No flights match',
  // bookings
  bookingsTitle: 'Bookings',
  bookingsHint: 'Search by PNR, email or passenger name.',
  searchBookings: 'PNR, email or name',
  paid: 'Paid',
  unpaid: 'Unpaid',
  recordPayment: 'Record payment',
  recorded: 'Payment recorded',
  recordFailed: 'Could not record the payment',
  noBookings: 'No bookings found',
  // payments
  paymentsTitle: 'M-Pesa verification',
  paymentsHint: 'Paste the confirmation SMS exactly as received.',
  pasteSms: 'M-Pesa message',
  parse: 'Check message',
  verify: 'Verify & mark paid',
  verified: 'Payment verified',
  verifyFailed: 'Could not verify the message',
  receipt: 'Receipt',
  amount: 'Amount',
  issues: 'Issues',
  records: 'Recent verifications',
  confirm: 'Confirm',
  reject: 'Reject',
  reason: 'Reason',
  confirmed: 'Record confirmed',
  rejected: 'Record rejected',
  noRecords: 'No verification records',
  paymentNumber: 'Payment number',
  // settings
  settingsTitle: 'Site settings',
  appName: 'App name',
  theme: 'Theme',
  savedSettings: 'Settings saved',
  settingsFailed: 'Could not save settings',
  // shared errors
  offline: 'Offline — answers come from this device.',
  online: 'Backend reachable.',
  genericError: 'Something went wrong',
} as const;

export type AdminMessageKey = keyof typeof en;

const sw: Record<AdminMessageKey, string> = {
  // shell
  offlineTools: 'Vifaa vya nje ya mtandao',
  console: 'Kituo cha udhibiti',
  signedInAs: 'Imesajiliwa kama {name}',
  signOut: 'Toka',
  language: 'Lugha',
  // auth gate
  staffLogin: 'Kuingia kwa mfanyakazi',
  loginHint: 'Ingia kwa akaunti yako ya airline ili kutumia vifaa hivi.',
  identifier: 'Barua pepe au simu',
  password: 'Nenosiri',
  signIn: 'Ingia',
  loginFailed: 'Imeshindikana kuingia',
  // tabs
  overview: 'Muhtasari',
  flights: 'Ndege',
  bookings: 'Maagizo',
  payments: 'Malipo',
  settings: 'Mipangilio',
  // overview
  revenue30: 'Mapato · siku 30 zilizopita',
  gross: 'Jumla',
  net: 'Safi',
  paymentsCount: 'Malipo',
  load7: 'Kiwango cha kujaa · siku 7 zijazo',
  flightsCount: 'Ndege',
  seatsSold: 'Viti vilivyouzwa',
  capacity: 'Uwezo',
  noData: 'Hakuna cha kuonyesha bado',
  // flights
  flightsTitle: 'Bei za ndege',
  flightsHint: 'Gusa nauli ili kubadilisha bei ya msingi (KES).',
  routeFilter: 'Msimbo wa kuanzia (mf. NBO)',
  search: 'Tafuta',
  basePrice: 'Bei ya msingi',
  save: 'Hifadhi',
  saved: 'Bei imebadilishwa',
  saveFailed: 'Imeshindikana kubadilisha bei',
  noFlights: 'Hakuna ndege zinazolingana',
  // bookings
  bookingsTitle: 'Maagizo',
  bookingsHint: 'Tafuta kwa PNR, barua pepe au jina la abiria.',
  searchBookings: 'PNR, barua pepe au jina',
  paid: 'Imelipwa',
  unpaid: 'Haijalipwa',
  recordPayment: 'Rekodi malipo',
  recorded: 'Malipo yamerekodiwa',
  recordFailed: 'Imeshindikana kurekodi malipo',
  noBookings: 'Hakuna maagizo yaliyopatikana',
  // payments
  paymentsTitle: 'Uthibitisho wa M-Pesa',
  paymentsHint: 'Bandika ujumbe wa uthibitisho hasa ulivyopokea.',
  pasteSms: 'Ujumbe wa M-Pesa',
  parse: 'Angalia ujumbe',
  verify: 'Thibitisha na lipa',
  verified: 'Malipo yamethibitishwa',
  verifyFailed: 'Imeshindikana kuthibitisha ujumbe',
  receipt: 'Risiti',
  amount: 'Kiasi',
  issues: 'Changamoto',
  records: 'Uthibitisho wa hivi karibuni',
  confirm: 'Thibitisha',
  reject: 'Kataa',
  reason: 'Sababu',
  confirmed: 'Rekodi imethibitishwa',
  rejected: 'Rekodi imekataliwa',
  noRecords: 'Hakuna rekodi za uthibitisho',
  paymentNumber: 'Namba ya malipo',
  // settings
  settingsTitle: 'Mipangilio ya tovuti',
  appName: 'Jina la programu',
  theme: 'Mandhari',
  savedSettings: 'Mipangilio imehifadhiwa',
  settingsFailed: 'Imeshindikana kuhifadhi mipangilio',
  // shared errors
  offline: 'Nje ya mtandao — majibu yanatoka kwenye kifaa hiki.',
  online: 'Seva inapatikana.',
  genericError: 'Kuna hitilafu imetokea',
};

const DICTS: Record<AdminLocale, Record<AdminMessageKey, string>> = { en, sw };

/** Translate a key, substituting `{name}`-style placeholders. */
export function t(
  locale: AdminLocale,
  key: AdminMessageKey,
  vars?: Record<string, string>,
): string {
  let text: string = DICTS[locale][key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), value);
    }
  }
  return text;
}

export const ADMIN_LOCALES: AdminLocale[] = ['en', 'sw'];

/** Exported for the parity spec. */
export const ADMIN_MESSAGE_DICTS = DICTS;
