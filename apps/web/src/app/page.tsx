import type {
  AirportDto,
  FlightOptionDto,
  FlightSearchResultDto,
  SiteSettingsDto,
} from '@kenyaairways/shared';
import { formatMoney } from '@kenyaairways/shared';
import Link from 'next/link';
import { SitePhoto } from '@/components/media/site-photo';
import { SearchForm } from '@/components/search-form';
import { PhotoCarousel, type CarouselItem } from '@/components/photo-carousel';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { destinationImage, siteImage } from '@/lib/site-images';

/** Airports whose destination photos and copy are curated in defaults. */
const CAROUSEL_CODES = ['MBA', 'KIS', 'DAR', 'EBB', 'JNB', 'LHR', 'DXB', 'CPT'];
/** Preferred order for the deals strip; other served airports fill the rest. */
const DEAL_PRIORITY = ['MBA', 'KIS', 'DAR', 'EBB', 'JNB', 'LHR', 'DXB', 'CPT', 'MYD', 'LAU', 'EDL'];

const isoDay = (departLocal: string): string => departLocal.slice(0, 10);

function cheapestFare(flight: FlightOptionDto): FlightOptionDto['fareOptions'][number] {
  let best = flight.fareOptions[0];
  for (const option of flight.fareOptions) {
    if (option.pricing.totalMinor < best.pricing.totalMinor) best = option;
  }
  return best;
}

type Deal = {
  code: string;
  city: string;
  dateIso: string;
  fareName: string;
  totalMinor: number;
  currency: FlightOptionDto['fareOptions'][number]['pricing']['currency'];
};

function pickDeals(results: FlightOptionDto[]): Deal[] {
  const byDest = new Map<string, FlightOptionDto>();
  for (const flight of results) {
    const key = flight.destination.code;
    const current = byDest.get(key);
    if (
      !current ||
      cheapestFare(flight).pricing.totalMinor < cheapestFare(current).pricing.totalMinor
    ) {
      byDest.set(key, flight);
    }
  }
  const ordered = [
    ...DEAL_PRIORITY.map((code) => byDest.get(code)),
    ...[...byDest.values()]
      .filter((flight) => !DEAL_PRIORITY.includes(flight.destination.code))
      .sort((a, b) => cheapestFare(a).pricing.totalMinor - cheapestFare(b).pricing.totalMinor),
  ].filter((flight): flight is FlightOptionDto => Boolean(flight));

  return ordered.slice(0, 4).map((flight) => {
    const fare = cheapestFare(flight);
    return {
      code: flight.destination.code,
      city: flight.destination.city,
      dateIso: isoDay(flight.departLocal),
      fareName: fare.fareClass.name,
      totalMinor: fare.pricing.totalMinor,
      currency: fare.pricing.currency,
    };
  });
}

const QUICK_ACTIONS = [
  { href: '/manage?tab=checkin', titleKey: 'qa.checkin', subKey: 'qa.checkin.sub', icon: 'door' },
  { href: '/pnr', titleKey: 'nav.manage', subKey: 'qa.manage.sub', icon: 'case' },
  {
    href: '/flights?trip=oneway&origin=NBO',
    titleKey: 'qa.schedule',
    subKey: 'qa.schedule.sub',
    icon: 'cal',
  },
  { href: '/status', titleKey: 'nav.status', subKey: 'qa.status.sub', icon: 'clock' },
] as const;

const QUICK_ICONS: Record<string, string> = {
  door: 'M4 20h16M7 20V6l7-2v16M17 9l3 2-3 2',
  case: 'M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  cal: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
};

const TILES = [
  { href: '/plan?tab=checklist', labelKey: 'menu.plan.requirements', image: 'manage' as const },
  { href: '/plan?tab=holidays', labelKey: 'menu.book.holidays', image: 'holidays' as const },
  { href: '/explore?tab=destinations', labelKey: 'menu.book.where', image: 'explore' as const },
  { href: '/alerts', labelKey: 'nav.alerts', image: 'plan' as const },
  { href: '/plan?tab=groups', labelKey: 'menu.plan.groups', image: 'experience' as const },
  { href: '/plan?tab=checklist#eta', labelKey: 'menu.plan.eta', image: 'rewards' as const },
];

/**
 * Landing page — airline-editorial layout: full-bleed photo hero with a
 * floating dark search panel (Flights/Holidays tabs), quick-action cards,
 * a real-data deals strip, Plan Your Trip tiles, promo banner, additional
 * services, destinations carousel and the cream alert band. Server
 * components throughout except the carousel island.
 */
export default async function HomePage() {
  const { t, locale } = await getTranslator();
  const [airports, site, search]: [
    AirportDto[] | null,
    SiteSettingsDto | null,
    FlightSearchResultDto | null,
  ] = await Promise.all([
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    getSiteSettings(),
    (async () => {
      const date = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
      return apiGetOrNull<FlightSearchResultDto>(`/api/v1/flights/search?origin=NBO&date=${date}`, {
        revalidate: 300,
      });
    })(),
  ]);

  const deals = search ? pickDeals(search.results) : [];

  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const carouselItems: CarouselItem[] = (airports ?? [])
    .filter((airport) => CAROUSEL_CODES.includes(airport.code))
    .map((airport) => ({
      href: `/flights?origin=NBO&destination=${airport.code}&trip=oneway`,
      src: destinationImage(site, airport.code),
      label: airport.city,
      sub: `${airport.code} · ${airport.country}`,
    }));

  return (
    <>
      {/* ── Hero: full-bleed photograph, editorial headline, floating search ── */}
      <section className="full-bleed relative isolate">
        <SitePhoto src={siteImage(site, 'hero')} alt="" eager className="absolute inset-0" />
        <div
          className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/25"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-12 lg:items-center lg:py-16">
          <div className="lg:col-span-6 xl:col-span-6">
            <span className="mb-4 block h-1 w-10 rounded-full bg-primary" aria-hidden="true" />
            <h1 className="max-w-xl font-display text-4xl italic leading-[1.08] text-white drop-shadow-sm sm:text-5xl">
              {t('hero.title')}
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/85 sm:text-base">
              {t('hero.subtitle')}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href="#search"
                className="rounded-sm bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
              >
                {t('hero.cta')}
              </a>
              <Link
                href="/explore?tab=destinations"
                className="text-sm font-medium text-white underline-offset-4 hover:underline"
              >
                {t('menu.book.where')}
              </Link>
            </div>

            {/* Polaroid collage — decorative, like the reference photo stack. */}
            <div className="mt-10 hidden flex-wrap gap-4 lg:flex" aria-hidden="true">
              {[
                destinationImage(site, 'MBA'),
                destinationImage(site, 'LHR'),
                siteImage(site, 'holidays'),
              ].map((src, index) => (
                <span
                  key={index}
                  className={`block w-36 border-4 border-white/95 p-1 shadow-xl ${
                    index === 1 ? '-rotate-2' : 'rotate-2'
                  }`}
                >
                  <SitePhoto src={src} alt="" className="h-24 bg-white/20" />
                </span>
              ))}
            </div>
          </div>

          {/* Floating dark search panel (Flights | Holidays tabs). */}
          <div id="search" className="scroll-mt-32 lg:col-span-6">
            <div className="rounded-xl bg-black/70 p-4 shadow-2xl backdrop-blur-md sm:p-5">
              <div
                className="mb-4 flex gap-1 border-b border-white/20 pb-3"
                role="tablist"
                aria-label={t('hero.tabFlights')}
              >
                <span
                  role="tab"
                  aria-selected="true"
                  className="border-b-2 border-primary px-3 pb-2 text-sm font-semibold text-white"
                >
                  {t('hero.tabFlights')}
                </span>
                <Link
                  href="/plan?tab=holidays"
                  role="tab"
                  aria-selected="false"
                  className="border-b-2 border-transparent px-3 pb-2 text-sm font-medium text-white/65 transition-colors hover:text-white"
                >
                  {t('hero.tabHolidays')}
                </Link>
              </div>
              {airports && airports.length > 0 ? (
                <SearchForm airports={airports} />
              ) : (
                <div className="rounded-lg border border-white/20 p-6 text-center text-sm text-white/80">
                  <p>{t('home.status.unreachable')}</p>
                  <Link
                    href="/flights"
                    className="mt-3 inline-block font-semibold text-white underline underline-offset-4"
                  >
                    {t('menu.book.flight')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Quick actions ── */}
      <section
        aria-label={t('home.quick.aria')}
        className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-accent/40"
          >
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path d={QUICK_ICONS[action.icon]} />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground group-hover:text-primary">
                {t(action.titleKey)}
                <span
                  aria-hidden="true"
                  className="text-primary opacity-0 transition-opacity group-hover:opacity-100"
                >
                  →
                </span>
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {t(action.subKey)}
              </span>
            </span>
          </Link>
        ))}
      </section>

      {/* ── Deals from Nairobi (real priced data) ── */}
      <section id="deals" aria-labelledby="deals-heading" className="mt-14 scroll-mt-32">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <span className="mb-2 block h-1 w-8 rounded-full bg-primary" aria-hidden="true" />
            <h2 id="deals-heading" className="font-display text-2xl italic sm:text-3xl">
              {t('home.deals.title', { city: t('home.deals.nairobi') })}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('home.deals.subtitle')}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden h-20 w-20 rotate-[-8deg] flex-col items-center justify-center rounded-full border-2 border-dashed border-primary text-center text-[10px] font-bold uppercase leading-tight text-primary sm:flex">
              {t('home.deals.guarantee')}
            </span>
            <Link
              href="/flights?origin=NBO&trip=oneway"
              className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              {t('home.deals.viewAll')}
            </Link>
          </div>
        </div>

        {deals.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {deals.map((deal) => (
              <li key={deal.code}>
                <Link
                  href={`/flights?origin=NBO&destination=${deal.code}&trip=oneway&date=${deal.dateIso}`}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-lg"
                >
                  <span className="relative block h-40">
                    <SitePhoto src={destinationImage(site, deal.code)} alt="" className="h-40" />
                    <span
                      aria-hidden="true"
                      className="absolute right-0 top-0 h-0 w-0 border-l-[26px] border-t-[26px] border-l-transparent border-t-primary"
                    />
                  </span>
                  <span className="flex flex-1 flex-col p-4">
                    <span className="font-display text-xl italic text-foreground">{deal.city}</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {dayFmt.format(new Date(`${deal.dateIso}T12:00:00`))} ·{' '}
                      {t('home.deals.oneWay', { cls: deal.fareName })}
                    </span>
                    <span className="mt-auto flex items-baseline gap-1.5 pt-3">
                      <span className="text-xs text-muted-foreground">{t('home.deals.from')}</span>
                      <span className="text-lg font-bold text-foreground">
                        {formatMoney(deal.totalMinor, deal.currency, locale)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('home.status.unreachable')}
          </p>
        )}
      </section>

      {/* ── Plan your trip tiles ── */}
      <section aria-labelledby="tiles-heading" className="mt-14">
        <div className="mb-5">
          <span className="mb-2 block h-1 w-8 rounded-full bg-primary" aria-hidden="true" />
          <h2 id="tiles-heading" className="font-display text-2xl italic sm:text-3xl">
            {t('home.tiles.title')}
          </h2>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {TILES.map((tile) => (
            <li key={tile.href}>
              <Link
                href={tile.href}
                className="group relative block h-36 overflow-hidden rounded-xl sm:h-40"
              >
                <SitePhoto src={siteImage(site, tile.image)} alt="" className="absolute inset-0" />
                <span
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
                  aria-hidden="true"
                />
                <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                  <span className="font-display text-sm italic leading-snug text-white">
                    {t(tile.labelKey)}
                  </span>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Full-width promo banner ── */}
      <section aria-labelledby="promo-heading" className="full-bleed relative mt-14">
        <SitePhoto src={siteImage(site, 'rewards')} alt="" className="absolute inset-0" />
        <div
          className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/35"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/75">
            {t('nav.rewards')}
          </p>
          <h2
            id="promo-heading"
            className="mx-auto mt-3 max-w-2xl font-display text-3xl italic leading-tight text-white sm:text-4xl"
          >
            {t('home.promo.title')}
          </h2>
          <Link
            href="/register"
            className="mt-6 inline-block rounded-sm bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
          >
            {t('menu.rew.join')}
          </Link>
        </div>
      </section>

      {/* ── Additional services ── */}
      <section aria-labelledby="services-heading" className="mt-14">
        <div className="mb-5">
          <span className="mb-2 block h-1 w-8 rounded-full bg-primary" aria-hidden="true" />
          <h2 id="services-heading" className="font-display text-2xl italic sm:text-3xl">
            {t('home.services.title')}
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Link
            href="/plan?tab=holidays"
            className="group relative block h-64 overflow-hidden rounded-xl lg:h-full lg:min-h-72"
          >
            <SitePhoto src={siteImage(site, 'holidays')} alt="" className="absolute inset-0" />
            <span
              className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent"
              aria-hidden="true"
            />
            <span className="absolute inset-x-5 bottom-5 text-white">
              <span className="mb-2 block h-1 w-7 rounded-full bg-primary" aria-hidden="true" />
              <span className="block font-display text-2xl italic">
                {t('menu.explore.action1')}
              </span>
              <span className="mt-1 block text-sm text-white/85">
                {t('home.services.holidaysSub')}
              </span>
            </span>
          </Link>

          <div className="flex flex-col gap-4">
            {[
              {
                href: '/experience?tab=service#seats',
                titleKey: 'menu.exp.seats',
                subKey: 'home.services.seatsSub',
                image: siteImage(site, 'experience'),
              },
              {
                href: '/experience?tab=service#lounge',
                titleKey: 'menu.exp.lounges',
                subKey: 'home.services.loungeSub',
                image: siteImage(site, 'rewards'),
              },
              {
                href: '/manage?tab=support#specials',
                titleKey: 'menu.plan.action2',
                subKey: 'home.services.assistSub',
                image: siteImage(site, 'manage'),
              },
            ].map((mini) => (
              <Link
                key={mini.href}
                href={mini.href}
                className="group flex flex-1 items-center gap-4 rounded-xl border bg-card p-3 transition-colors hover:border-primary/60"
              >
                <SitePhoto src={mini.image} alt="" className="h-20 w-28 shrink-0 rounded-lg" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground group-hover:text-primary">
                    {t(mini.titleKey)}
                    <span aria-hidden="true" className="text-primary">
                      →
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {t(mini.subKey)}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <Link
              href="/experience?tab=fleet"
              className="group relative block h-44 flex-1 overflow-hidden rounded-xl"
            >
              <SitePhoto src={siteImage(site, 'experience')} alt="" className="absolute inset-0" />
              <span
                className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent"
                aria-hidden="true"
              />
              <span className="absolute inset-x-5 bottom-4 text-white">
                <span className="block font-display text-xl italic">{t('menu.exp.action1')}</span>
              </span>
            </Link>
            <Link
              href="/manage?tab=support#payment"
              className="group flex flex-1 items-center gap-4 rounded-xl border bg-card p-3 transition-colors hover:border-primary/60"
            >
              <SitePhoto
                src={siteImage(site, 'plan')}
                alt=""
                className="h-20 w-28 shrink-0 rounded-lg"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground group-hover:text-primary">
                  {t('menu.book.payment')}
                  <span aria-hidden="true" className="text-primary">
                    →
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {t('home.services.paymentSub')}
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Destinations carousel (stopover slot) ── */}
      {carouselItems.length > 0 && (
        <section aria-labelledby="carousel-heading" className="full-bleed mt-14 bg-[#141217] py-12">
          <div className="mx-auto w-full max-w-6xl px-4">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <span className="mb-2 block h-1 w-8 rounded-full bg-primary" aria-hidden="true" />
                <h2
                  id="carousel-heading"
                  className="font-display text-2xl italic text-white sm:text-3xl"
                >
                  {t('home.carousel.title')}
                </h2>
              </div>
              <Link
                href="/explore?tab=destinations"
                className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
              >
                {t('menu.book.where')}
              </Link>
            </div>
            <PhotoCarousel
              items={carouselItems}
              prevLabel={t('home.carousel.prev')}
              nextLabel={t('home.carousel.next')}
              gotoLabel={t('home.carousel.goto')}
            />
          </div>
        </section>
      )}

      {/* ── Cream alert band ── */}
      <section aria-labelledby="alerts-heading" className="full-bleed mt-0 bg-[#F7F2E7] py-14">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <span
            className="mx-auto mb-3 block h-1 w-10 rounded-full bg-primary"
            aria-hidden="true"
          />
          <h2 id="alerts-heading" className="font-display text-3xl italic text-[#1A171B]">
            {t('home.alerts.title')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#4A444C]">{t('home.alerts.body')}</p>
          <Link
            href="/alerts"
            className="mt-6 inline-block rounded-sm bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
          >
            {t('home.alerts.cta')}
          </Link>
          <p className="mt-4 text-xs text-[#6B646E]">{t('home.alerts.note')}</p>
        </div>
      </section>
    </>
  );
}
