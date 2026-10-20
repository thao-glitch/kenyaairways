import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * M10 end-to-end passenger journey — drives the real UI, the real API and
 * the mock M-Pesa provider:
 *
 *   register → search → fare → book → pay (STK simulate) → confirm →
 *   PNR lookup → seat selection → check-in → boarding pass
 *
 * The stack must already be running (compose or dev servers). The one piece
 * of intelligence that is *not* done through the UI: before searching, we
 * probe the API for a flight inside the check-in window (departure now+1.5h
 * … now+23h) — the browser cannot know tomorrow's timetable and check-in is
 * only legal inside that window (24h open, 60min cutoff).
 */
const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

interface Candidate {
  date: string;
  destination: string;
  flightId: string;
}

/** Airport-local (Africa/Nairobi, UTC+3) calendar date `offset` days out. */
function nairobiDate(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
}

async function probeCandidate(api: APIRequestContext): Promise<Candidate> {
  const now = Date.now();
  const inWindow = (iso: string): boolean => {
    const leadMs = Date.parse(iso) - now;
    return leadMs > 1.5 * 3_600_000 && leadMs < 23 * 3_600_000;
  };
  for (let offset = 0; offset <= 2; offset += 1) {
    const date = nairobiDate(offset);
    for (const destination of ['MBA', 'KIS', 'EDL']) {
      const res = await api.get(
        `${API_URL}/api/v1/flights/search?origin=NBO&destination=${destination}&date=${date}`,
      );
      expect(res.ok(), `search NBO→${destination} ${date}`).toBeTruthy();
      const body = (await res.json()) as {
        results: Array<{ flightId: string; departUtc: string }>;
      };
      const qualifying = body.results
        .filter((r) => inWindow(r.departUtc))
        .sort((a, b) => Date.parse(a.departUtc) - Date.parse(b.departUtc));
      if (qualifying.length > 0) {
        return { date, destination, flightId: qualifying[0]!.flightId };
      }
    }
  }
  throw new Error(
    `no flight departs between now+1.5h and now+23h across NBO→MBA/KIS/EDL for ${nairobiDate(0)}..${nairobiDate(2)} — seed the database first`,
  );
}

test.describe('passenger journey (e2e)', () => {
  test('search → book → pay → PNR → seat → check-in → boarding pass', async ({ page, request }) => {
    const stamp = Date.now();
    const email = `e2e+${stamp}@kenyaairways.example`;
    const phone = `+2547${String(stamp % 1e8).padStart(8, '0')}`;

    // ── Register ──────────────────────────────────────────────────────────
    await page.goto('/register');
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(`Traveller${stamp % 1e5}`);
    await page.getByLabel('Email (optional)').fill(email);
    await page.getByLabel('Phone (optional)').fill(phone);
    await page.getByLabel('Password').fill('E2ePassw0rd!');
    await page.getByRole('checkbox', { name: /I agree to the terms/ }).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/pnr');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // ── Search through the real form ──────────────────────────────────────
    const candidate = await probeCandidate(request);
    await page.goto('/flights');
    await page.getByLabel('From').selectOption('NBO');
    await page.getByLabel('To').selectOption(candidate.destination);
    await page.getByLabel('Date').fill(candidate.date);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForURL(/\/flights\?/);

    const card = page.locator(`a[href="/flights/${candidate.flightId}"]`);
    await expect(card).toBeVisible();
    await card.click();

    // ── Fare → booking form ───────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Fares', exact: true })).toBeVisible();
    await page.locator('a[href^="/book?flightId="]').first().click();
    await page.waitForURL(/\/book\?/);
    await expect(page.getByRole('heading', { name: 'Book your flight' })).toBeVisible();
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(`Traveller${stamp % 1e5}`);
    await page.getByLabel('Email (optional)').fill(email);
    await page.getByLabel('Phone (optional)').fill(phone);
    await page.getByRole('button', { name: 'Hold seats & continue' }).click();

    // ── Booking hub: PNR + payment ────────────────────────────────────────
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByRole('heading', { name: 'My booking' })).toBeVisible();
    const pnr = (await page.locator('span.font-mono.tracking-widest').first().textContent())
      ?.trim()
      .toUpperCase();
    expect(pnr, 'booking must show a PNR').toMatch(/^[A-Z0-9]{6}$/);

    await page.getByLabel('M-Pesa number').fill(phone);
    await page.getByRole('button', { name: 'Pay with M-Pesa' }).click();
    await expect(
      page.getByText('STK push sent. Check your phone and enter your M-Pesa PIN.'),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Simulate: success' }).click();
    // The payment card unmounts once the booking confirms (the transient
    // "Paid" badge is already gone by then) — "Confirmed" is the durable
    // terminal state that successful payment produces.
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    // ── Issue tickets (check-in refuses without them) ─────────────────────
    await page.getByRole('button', { name: 'Issue tickets' }).click();
    await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    // ── PNR lookup round-trip ─────────────────────────────────────────────
    await page.goto('/pnr');
    await page.getByLabel('Booking reference').fill(pnr!);
    await page.getByRole('button', { name: 'Find' }).click();
    const open = page
      .getByRole('button', { name: 'Open booking' })
      .or(page.getByRole('link', { name: 'Open booking' }))
      .first();
    await expect(open).toBeVisible();
    await open.click();
    await page.waitForURL(/\/bookings\//);

    // ── Seat selection ────────────────────────────────────────────────────
    const freeSeat = page.getByRole('button', { name: /\d{1,2}[A-F] — Free/ }).first();
    await expect(freeSeat).toBeVisible();
    await freeSeat.click();
    // Two indicators carry the same text (counter + aircraft line).
    await expect(page.getByText('1 seats selected').first()).toBeVisible();

    // ── Check-in (must be inside the window — see probeCandidate) ─────────
    await page.getByRole('button', { name: 'Check in now' }).click();
    await expect(page.getByText('Checked in', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    // ── Boarding pass ─────────────────────────────────────────────────────
    const pass = page
      .getByRole('button', { name: 'Boarding pass' })
      .or(page.getByRole('link', { name: 'Boarding pass' }))
      .first();
    await pass.click();
    await page.waitForURL(/\/boarding-passes\//);
    await expect(page.getByRole('heading', { name: 'Boarding pass' })).toBeVisible();
    await expect(page.getByText('IATA BCBP payload (encoded in the barcode)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print pass' })).toBeVisible();
  });
});
