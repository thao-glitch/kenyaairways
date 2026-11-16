import { NextRequest, NextResponse } from 'next/server';

const siteSettings = {
  appName: 'Kenya Airways.',
  theme: 'sky',
  images: {},
  mpesaPaybill: '444174',
};

const mockFlights = [
  {
    flightId: 'mock-1',
    flightNumber: 'F13101',
    origin: { code: 'NBO', city: 'Nairobi', name: 'Jomo Kenyatta International' },
    destination: { code: 'MBA', city: 'Maasai Mara', name: 'Mara Serena Airstrip' },
    departLocal: '2026-11-20T06:00:00',
    arriveLocal: '2026-11-20T07:15:00',
    status: 'SCHEDULED',
    aircraft: { code: 'B738', name: 'Boeing 737-800' },
    fareOptions: [
      {
        fareClass: {
          code: 'ECONOMY',
          name: 'Economy',
          cabin: 'ECONOMY',
          baggageKg: 23,
          carryOnKg: 7,
          changesAllowed: true,
          refundable: false,
        },
        seatsAvailable: 18,
        pricing: {
          currency: 'KES',
          baseFareMinor: 1850000,
          taxes: [],
          taxesTotalMinor: 0,
          totalMinor: 1850000,
        },
      },
    ],
  },
  {
    flightId: 'mock-2',
    flightNumber: 'F13102',
    origin: { code: 'NBO', city: 'Nairobi', name: 'Jomo Kenyatta International' },
    destination: { code: 'KIS', city: 'Kisumu', name: 'Kisumu International Airport' },
    departLocal: '2026-11-20T08:30:00',
    arriveLocal: '2026-11-20T09:20:00',
    status: 'SCHEDULED',
    aircraft: { code: 'E190', name: 'Embraer 190' },
    fareOptions: [
      {
        fareClass: {
          code: 'ECONOMY',
          name: 'Economy',
          cabin: 'ECONOMY',
          baggageKg: 23,
          carryOnKg: 7,
          changesAllowed: true,
          refundable: false,
        },
        seatsAvailable: 25,
        pricing: {
          currency: 'KES',
          baseFareMinor: 950000,
          taxes: [],
          taxesTotalMinor: 0,
          totalMinor: 950000,
        },
      },
    ],
  },
  {
    flightId: 'mock-3',
    flightNumber: 'F13103',
    origin: { code: 'NBO', city: 'Nairobi', name: 'Jomo Kenyatta International' },
    destination: { code: 'MBA', city: 'Maasai Mara', name: 'Mara Serena Airstrip' },
    departLocal: '2026-11-20T10:00:00',
    arriveLocal: '2026-11-20T11:00:00',
    status: 'SCHEDULED',
    aircraft: { code: 'B738', name: 'Boeing 737-800' },
    fareOptions: [
      {
        fareClass: {
          code: 'ECONOMY',
          name: 'Economy',
          cabin: 'ECONOMY',
          baggageKg: 23,
          carryOnKg: 7,
          changesAllowed: true,
          refundable: false,
        },
        seatsAvailable: 30,
        pricing: {
          currency: 'KES',
          baseFareMinor: 1757500,
          taxes: [],
          taxesTotalMinor: 0,
          totalMinor: 1757500,
        },
      },
    ],
  },
];

const mockBookings = [
  {
    id: 'mock-b1',
    pnr: 'F13ABC12',
    status: 'CONFIRMED',
    totalMinor: 850000,
    currency: 'KES',
    createdAt: new Date().toISOString(),
    flights: [],
    passengers: [],
  },
  {
    id: 'mock-b2',
    pnr: 'F13DEF34',
    status: 'PENDING_PAYMENT',
    totalMinor: 650000,
    currency: 'KES',
    createdAt: new Date().toISOString(),
    flights: [],
    passengers: [],
  },
];

const mockUsers = [
  {
    id: 'mock-u1',
    email: 'demo@kenyaairways.example',
    firstName: 'Demo',
    lastName: 'User',
    role: 'PASSENGER',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'mock-u2',
    email: 'admin@kenyaairways.example',
    firstName: 'Admin',
    lastName: 'User',
    role: 'ADMIN',
    createdAt: new Date().toISOString(),
  },
];

const mockPaymentConfig = {
  mpesaPaybill: '444174',
  mpesaAccount: '05515',
  methods: [{ id: 'mpesa', name: 'M-Pesa', enabled: true, type: 'MPESA_MANUAL' }],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  if (path === '/site-settings' || path === '/admin/site-settings')
    return NextResponse.json(siteSettings);
  if (path === '/meta') return NextResponse.json({ version: '1.0.0', name: 'Kenya Airways Admin' });
  if (path === '/admin/flights' || path.startsWith('/admin/flights?'))
    return NextResponse.json({ items: mockFlights, total: mockFlights.length });
  if (path === '/admin/bookings' || path.startsWith('/admin/bookings?'))
    return NextResponse.json({ items: mockBookings, total: mockBookings.length });
  if (path === '/admin/users' || path.startsWith('/admin/users?'))
    return NextResponse.json({ items: mockUsers, total: mockUsers.length, page: 1, pageSize: 20 });
  if (path === '/admin/payment-config') return NextResponse.json(mockPaymentConfig);
  if (path === '/admin/media') return NextResponse.json([]);
  if (path === '/admin/mpesa-verifier/records')
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25, hasMore: false });
  if (path.startsWith('/admin/mpesa-verifier/parse'))
    return NextResponse.json({
      parsed: {},
      issues: [],
      paymentId: null,
      bookingId: null,
      pnr: null,
      amountExpectedMinor: null,
      receiptAvailable: true,
    });
  if (path === '/bookings') return NextResponse.json(mockBookings);
  if (path.startsWith('/bookings/')) return NextResponse.json(mockBookings[0]);
  if (path === '/payments') return NextResponse.json([]);
  if (path === '/pnr/' + searchParams.get('code')) return NextResponse.json(mockBookings[0]);
  if (path.startsWith('/pnr/')) return NextResponse.json(mockBookings[0]);
  if (path === '/flights/search') {
    const origin = searchParams.get('origin') || 'NBO';
    const destination = searchParams.get('destination') || 'MBA';
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      query: { origin, destination, date, adults: 1, trip: 'oneway' },
      results: mockFlights,
      meta: { count: mockFlights.length, currency: 'KES' },
    });
  }
  if (path.startsWith('/flights/')) return NextResponse.json(mockFlights[0]);
  if (path === '/airports') return NextResponse.json([]);
  if (path === '/auth/me')
    return NextResponse.json({
      id: 'mock-admin',
      email: 'admin@kenyaairways.example',
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
    });
  if (path === '/healthz' || path === '/readyz')
    return NextResponse.json({ status: 'ok', version: '1.0.0' });
  if (path === '/ops/flights/' || path.startsWith('/ops/'))
    return NextResponse.json({ flights: mockFlights });
  if (path === '/ops/dispatches' || path.startsWith('/ops/dispatches'))
    return NextResponse.json({ dispatches: [] });
  if (path === '/ops/manifests' || path.startsWith('/ops/manifests'))
    return NextResponse.json({ manifests: [] });
  if (path.startsWith('/reports/')) return NextResponse.json({ data: [], total: 0 });
  return NextResponse.json({});
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  const body = await request.json().catch(() => ({}));

  if (path === '/auth/login')
    return NextResponse.json({
      accessToken: 'mock-token',
      user: {
        id: 'mock-admin',
        email: body.email || 'admin@kenyaairways.example',
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
      },
    });
  if (path === '/auth/register')
    return NextResponse.json({
      accessToken: 'mock-token',
      user: {
        id: 'mock-admin',
        email: body.email || 'admin@kenyaairways.example',
        firstName: body.firstName || 'Admin',
        lastName: body.lastName || 'User',
        role: 'ADMIN',
      },
    });
  if (path === '/auth/refresh') return NextResponse.json({ accessToken: 'mock-token' });
  if (path === '/auth/logout') return NextResponse.json({ success: true });
  if (path === '/auth/otp/request') return NextResponse.json({ sent: true });
  if (path === '/admin/mpesa-verifier/parse')
    return NextResponse.json({
      parsed: {},
      issues: [],
      paymentId: null,
      bookingId: null,
      pnr: null,
      amountExpectedMinor: null,
      receiptAvailable: true,
    });
  if (path === '/admin/mpesa-verifier/verify')
    return NextResponse.json({
      record: { id: 'mock-v1', status: 'CONFIRMED', receiptNumber: 'AUTO-' + Date.now() },
      payment: { id: 'mock-p1', status: 'PAID' },
    });
  if (path === '/admin/media') return NextResponse.json({ url: '/photos/hero.jpg' });
  if (path === '/admin/site-settings') return NextResponse.json(siteSettings);
  if (path === '/admin/payment-config') return NextResponse.json(mockPaymentConfig);
  if (path === '/admin/flights/bulk-prices') return NextResponse.json({ updated: 0 });
  if (path.startsWith('/admin/flights/') && path.includes('/fares'))
    return NextResponse.json({ updated: 0 });
  if (path === '/admin/bookings' || path.startsWith('/admin/bookings?'))
    return NextResponse.json({ items: mockBookings, total: mockBookings.length });
  if (path.startsWith('/admin/bookings/') && path.endsWith('/pay'))
    return NextResponse.json({ payment: { id: 'mock-p1', status: 'PAID' } });
  if (path === '/bookings') return NextResponse.json(mockBookings[0]);
  if (path === '/payments')
    return NextResponse.json({
      id: 'mock-p1',
      status: 'REQUIRES_ACTION',
      manual: true,
      amountMinor: 850000,
      currency: 'KES',
      createdAt: new Date().toISOString(),
    });
  if (path.startsWith('/payments/') && path.includes('mpesa-manual'))
    return NextResponse.json({
      record: { id: 'mock-v1', status: 'CONFIRMED', receiptNumber: 'AUTO-' + Date.now() },
      payment: { id: 'mock-p1', status: 'PAID' },
    });
  if (path === '/pnr/' || path.startsWith('/pnr/')) return NextResponse.json(mockBookings[0]);
  if (path === '/ticketing/issue')
    return NextResponse.json({ ticketNumber: 'TKT-' + Date.now(), status: 'ISSUED' });
  if (path.startsWith('/ops/flights/') && path.includes('/status'))
    return NextResponse.json({ status: 'SCHEDULED' });
  if (path === '/ops/manifests' || path.startsWith('/ops/manifests'))
    return NextResponse.json({ id: 'mock-m1', status: 'DISPATCHED' });
  if (path.startsWith('/reports/')) return NextResponse.json({ data: [], total: 0 });
  return NextResponse.json({ success: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  if (path === '/admin/site-settings') return NextResponse.json(siteSettings);
  if (path.startsWith('/admin/payment-config')) return NextResponse.json(mockPaymentConfig);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return NextResponse.json({ success: true });
}
