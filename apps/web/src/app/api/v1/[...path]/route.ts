import { NextRequest, NextResponse } from 'next/server';
import airports from '@/lib/mock/airports.json';

// Mock site settings
const siteSettings = {
  appName: 'Kenya Airways.',
  theme: 'sky',
  images: {},
  mpesaPaybill: '444174',
};

// Mock flight generator
function mockFlights(origin: string, destination: string, date: string) {
  const airlines = ['Kenya Airways', 'Jambojet', 'Safarilink'];
  const flights = [];
  const basePrice = origin === 'NBO' ? 8500 : 12000;
  for (let i = 0; i < 5; i++) {
    const hour = 6 + i * 3;
    const dur = 60 + Math.floor(Math.random() * 120);
    const arriveHour = hour + Math.floor(dur / 60);
    const arriveMin = dur % 60;
    flights.push({
      flightId: `mock-${origin}-${destination}-${i}`,
      flightNumber: `F13${100 + i}`,
      routeType: 'INTERNATIONAL',
      origin: {
        code: origin,
        name: airports.find((a: any) => a.code === origin)?.name || origin,
        city: airports.find((a: any) => a.code === origin)?.city || origin,
        country: airports.find((a: any) => a.code === origin)?.country || '',
        timezone: airports.find((a: any) => a.code === origin)?.timezone || 'UTC',
      },
      destination: {
        code: destination,
        name: airports.find((a: any) => a.code === destination)?.name || destination,
        city: airports.find((a: any) => a.code === destination)?.city || destination,
        country: airports.find((a: any) => a.code === destination)?.country || '',
        timezone: airports.find((a: any) => a.code === destination)?.timezone || 'UTC',
      },
      departUtc: `${date}T${String(hour).padStart(2, '0')}:00:00Z`,
      arriveUtc: `${date}T${String(arriveHour).padStart(2, '0')}:${String(arriveMin).padStart(2, '0')}:00Z`,
      departLocal: `${date}T${String(hour).padStart(2, '0')}:00:00`,
      arriveLocal: `${date}T${String(arriveHour).padStart(2, '0')}:${String(arriveMin).padStart(2, '0')}:00`,
      durationMinutes: dur,
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
          seatsAvailable: 20 - i * 2,
          pricing: {
            currency: 'KES',
            baseFareMinor: (basePrice + i * 500) * 100,
            taxes: [],
            taxesTotalMinor: 0,
            totalMinor: (basePrice + i * 500) * 100,
          },
        },
        {
          fareClass: {
            code: 'BUSINESS',
            name: 'Business',
            cabin: 'BUSINESS',
            baggageKg: 32,
            carryOnKg: 10,
            changesAllowed: true,
            refundable: true,
          },
          seatsAvailable: 8,
          pricing: {
            currency: 'KES',
            baseFareMinor: (basePrice * 3 + i * 1000) * 100,
            taxes: [],
            taxesTotalMinor: 0,
            totalMinor: (basePrice * 3 + i * 1000) * 100,
          },
        },
      ],
    });
  }
  return {
    query: { origin, destination, date, adults: 1, trip: 'oneway' },
    results: flights,
    meta: { count: flights.length, currency: 'KES' },
  };
}

function mockBooking(id: string) {
  return {
    id,
    pnr: 'F13' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    status: 'HELD',
    tripType: 'ONE_WAY',
    source: 'WEB',
    currency: 'KES',
    totalMinor: 850000,
    breakdown: [],
    contactEmail: 'demo@kenyaairways.example',
    contactPhone: '+254712345678',
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    locale: 'en-KE',
    holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    segments: [
      {
        seq: 1,
        flightId: 'mock-NBO-MBA-0',
        flightNumber: 'F13100',
        originCode: 'NBO',
        destinationCode: 'MBA',
        departUtc: new Date(Date.now() + 86400000).toISOString(),
        arriveUtc: new Date(Date.now() + 86400000 + 3600000).toISOString(),
        departLocal: new Date(Date.now() + 86400000).toISOString().replace('Z', ''),
        arriveLocal: new Date(Date.now() + 86400000 + 3600000).toISOString().replace('Z', ''),
      },
    ],
    passengers: [{ seq: 1, type: 'ADULT', firstName: 'Demo', lastName: 'User' }],
    seatHolds: [],
  };
}

function mockPayment(id: string, bookingId: string) {
  return {
    id,
    bookingId,
    provider: 'MPESA_MANUAL',
    status: 'REQUIRES_ACTION',
    amountMinor: 850000,
    currency: 'KES',
    idempotencyKey: 'mock-' + id,
    providerRef: null,
    clientSecret: null,
    failureCode: null,
    failureMessage: null,
    paidAt: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    manual: true,
    createdAt: new Date().toISOString(),
  };
}

// In-memory store for mock data
const store: Record<string, any> = {
  bookings: {},
  payments: {},
  verifications: {},
};

function generateId() {
  return 'mock-' + Math.random().toString(36).substring(2, 15);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  // Airports
  if (path === '/airports') {
    return NextResponse.json(airports);
  }

  // Site settings
  if (path === '/site-settings') {
    return NextResponse.json(siteSettings);
  }

  // Flight search
  if (path === '/flights/search' || path === '/flights') {
    const origin = searchParams.get('origin') || 'NBO';
    const destination = searchParams.get('destination') || 'MBA';
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    return NextResponse.json(mockFlights(origin, destination, date));
  }

  // Flight calendar
  if (path === '/flights/calendar') {
    const origin = searchParams.get('origin') || 'NBO';
    const destination = searchParams.get('destination') || 'MBA';
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const days = [];
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      days.push({
        date,
        lowestTotalMinor:
          Math.random() > 0.2 ? (8000 + Math.floor(Math.random() * 4000)) * 100 : null,
        flightCount: Math.random() > 0.2 ? Math.floor(Math.random() * 4) + 1 : 0,
      });
    }
    return NextResponse.json({
      origin,
      destination,
      month,
      currency: 'KES',
      days,
      bestDate: days.find((d) => d.lowestTotalMinor)?.date,
    });
  }

  // Flights by ID
  if (path.match(/^\/flights\/[^/]+$/)) {
    const id = path.split('/')[2];
    const flight = mockFlights('NBO', 'MBA', new Date().toISOString().slice(0, 10)).results[0];
    flight.flightId = id;
    return NextResponse.json(flight);
  }

  // Payments list
  if (path === '/payments') {
    const bookingId = searchParams.get('bookingId');
    const payments = Object.values(store.payments).filter(
      (p: any) => !bookingId || p.bookingId === bookingId,
    );
    return NextResponse.json(payments);
  }

  // Payment by ID
  if (path.match(/^\/payments\/[^/]+$/) && !path.includes('mpesa-manual')) {
    const id = path.split('/')[2];
    if (store.payments[id]) {
      return NextResponse.json(store.payments[id]);
    }
    return NextResponse.json(mockPayment(id, 'mock-booking'), { status: 200 });
  }

  // Mpesa manual verification check
  if (path.match(/^\/payments\/[^/]+\/mpesa-manual$/)) {
    const id = path.split('/')[2];
    const v = store.verifications[id];
    return NextResponse.json(v || null);
  }

  // Bookings list
  if (path === '/bookings') {
    const bookings = Object.values(store.bookings);
    return NextResponse.json(bookings);
  }

  // Booking by ID
  if (path.match(/^\/bookings\/[^/]+$/)) {
    const id = path.split('/')[2];
    if (store.bookings[id]) {
      return NextResponse.json(store.bookings[id]);
    }
    return NextResponse.json(mockBooking(id), { status: 200 });
  }

  // Fleet
  if (path === '/fleet') {
    return NextResponse.json({
      types: [
        { code: 'B738', name: 'Boeing 737-800', seats: 189, range: 'Medium-haul' },
        { code: 'B788', name: 'Boeing 787-8 Dreamliner', seats: 234, range: 'Long-haul' },
        { code: 'E190', name: 'Embraer 190', seats: 96, range: 'Regional' },
      ],
    });
  }

  // Fare classes
  if (path === '/fare-classes') {
    return NextResponse.json([
      { code: 'ECONOMY', name: 'Economy', cabin: 'ECONOMY' },
      { code: 'PREMIUM', name: 'Premium Economy', cabin: 'PREMIUM_ECONOMY' },
      { code: 'BUSINESS', name: 'Business', cabin: 'BUSINESS' },
    ]);
  }

  // Flight status board
  if (path === '/flights/status-board') {
    return NextResponse.json({
      flightNumber: searchParams.get('flightNumber'),
      status: 'SCHEDULED',
      gate: 'A12',
      terminal: '1A',
      delay: 0,
      onTime: true,
    });
  }

  // PNR lookup
  if (path.startsWith('/pnr/')) {
    return NextResponse.json({
      pnr: path.split('/')[2],
      status: 'CONFIRMED',
      flights: [],
      passengers: [],
      totalMinor: 850000,
      currency: 'KES',
      createdAt: new Date().toISOString(),
    });
  }

  // Check-in
  if (path === '/check-in' || path.startsWith('/check-in?')) {
    return NextResponse.json({ boardingPasses: [], checkedIn: false });
  }

  // Price alerts
  if (path === '/price-alerts') {
    return NextResponse.json([]);
  }

  // Ticketing issue
  if (path === '/ticketing/issue') {
    return NextResponse.json({ ticketNumber: 'TKT-' + Date.now(), status: 'ISSUED' });
  }

  // Seats
  if (path.match(/\/flights\/[^/]+\/seats/)) {
    const seats = [];
    for (let r = 1; r <= 30; r++) {
      for (const col of ['A', 'B', 'C', 'D', 'E', 'F']) {
        seats.push({
          label: `${r}${col}`,
          row: r,
          column: col,
          status: Math.random() > 0.3 ? 'AVAILABLE' : 'OCCUPIED',
          priceMinor: 0,
        });
      }
    }
    return NextResponse.json({ seats, aircraft: 'B738' });
  }

  // Flights by ID
  if (
    path.match(/^\/flights\/[^/]+$/) &&
    !path.includes('search') &&
    !path.includes('calendar') &&
    !path.includes('status-board')
  ) {
    const id = path.split('/')[2];
    const flight = mockFlights('NBO', 'MBA', new Date().toISOString().slice(0, 10)).results[0];
    flight.flightId = id;
    return NextResponse.json(flight);
  }

  // Media
  if (path.startsWith('/media/')) {
    return NextResponse.json({ url: '/photos/hero.jpg' });
  }

  // Health check
  if (path === '/healthz' || path === '/readyz') {
    return NextResponse.json({ status: 'ok', version: '1.0.0' });
  }

  // Auth - session check
  if (path === '/auth/me') {
    return NextResponse.json({
      id: 'mock-user',
      email: 'demo@kenyaairways.example',
      firstName: 'Demo',
      lastName: 'User',
      role: 'PASSENGER',
    });
  }

  // Default: return empty success
  return NextResponse.json({});
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  const body = await request.json().catch(() => ({}));

  // Auth login
  if (path === '/auth/login') {
    return NextResponse.json({
      accessToken: 'mock-token',
      user: {
        id: 'mock-user',
        email: body.email || 'demo@kenyaairways.example',
        firstName: 'Demo',
        lastName: 'User',
        role: 'PASSENGER',
      },
    });
  }

  // Auth register
  if (path === '/auth/register') {
    return NextResponse.json({
      accessToken: 'mock-token',
      user: {
        id: 'mock-user',
        email: body.email || 'demo@kenyaairways.example',
        firstName: body.firstName || 'Demo',
        lastName: body.lastName || 'User',
        role: 'PASSENGER',
      },
    });
  }

  // Auth refresh
  if (path === '/auth/refresh') {
    return NextResponse.json({ accessToken: 'mock-token' });
  }

  // Create booking
  if (path === '/bookings') {
    const id = generateId();
    const booking = {
      id,
      pnr: 'F13' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      status: 'HELD',
      totalMinor: 850000,
      currency: 'KES',
      flights: [],
      passengers: [],
      createdAt: new Date().toISOString(),
      ...body,
    };
    store.bookings[id] = booking;
    return NextResponse.json(booking, { status: 201 });
  }

  // Create payment
  if (path === '/payments') {
    const id = generateId();
    const payment = {
      id,
      bookingId: body.bookingId,
      status: 'REQUIRES_ACTION',
      manual: body.manual || false,
      amountMinor: 850000,
      currency: 'KES',
      createdAt: new Date().toISOString(),
    };
    store.payments[id] = payment;
    return NextResponse.json(payment, { status: 201 });
  }

  // Mpesa manual verification (auto-accept)
  if (path.match(/^\/payments\/[^/]+\/mpesa-manual$/)) {
    const id = path.split('/')[2];
    const payment = store.payments[id] || mockPayment(id, 'mock-booking');
    payment.status = 'PAID';
    store.payments[id] = payment;
    const record = {
      id: generateId(),
      receiptNumber: 'AUTO-' + Date.now(),
      status: 'CONFIRMED',
      paymentId: id,
      bookingId: payment.bookingId,
      createdAt: new Date().toISOString(),
    };
    store.verifications[id] = record;
    // Update booking status
    if (store.bookings[payment.bookingId]) {
      store.bookings[payment.bookingId].status = 'CONFIRMED';
    }
    return NextResponse.json({ record, payment }, { status: 201 });
  }

  // Default
  return NextResponse.json({ success: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + (pathSegments || []).join('/');
  return NextResponse.json({ success: true });
}
