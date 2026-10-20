'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/components/i18n-provider';

/**
 * Desktop mega navigation: six top-level items (five opening a full-width
 * panel of link columns + a promo card + two wide action buttons, Help as a
 * direct link). Panels open on hover, stay open while the pointer is inside,
 * and also toggle by click/keyboard (aria-expanded) — Escape and outside
 * clicks close. Mirrors airline-site conventions without copying any
 * specific site: every link points at a real route or anchored tab in this
 * app. On small screens the bar scrolls horizontally under the brand.
 */

type LinkItem = { href: string; labelKey: string };
type Column = { titleKey: string; links: LinkItem[] };
type MenuId = 'explore' | 'plan' | 'bookmanage' | 'experience' | 'rewards';

type Menu = {
  id: MenuId;
  root: string;
  triggerKey: string;
  columns: Column[];
  promo: LinkItem & { titleKey: string; image: string };
  actions: (LinkItem & { icon: IconName })[];
};

const MENUS: Menu[] = [
  {
    id: 'explore',
    root: '/explore',
    triggerKey: 'nav.explore',
    columns: [
      {
        titleKey: 'menu.explore.destinations',
        links: [
          { href: '/explore?tab=destinations#africa', labelKey: 'menu.region.africa' },
          { href: '/explore?tab=destinations#europe', labelKey: 'menu.region.europe' },
          { href: '/explore?tab=destinations#asia', labelKey: 'menu.region.asia' },
          {
            href: '/explore?tab=destinations#north-america',
            labelKey: 'menu.region.north-america',
          },
          {
            href: '/explore?tab=destinations#south-america',
            labelKey: 'menu.region.south-america',
          },
          { href: '/explore?tab=destinations#oceania', labelKey: 'menu.region.oceania' },
          { href: '/explore?tab=destinations#antarctica', labelKey: 'menu.region.antarctica' },
        ],
      },
      {
        titleKey: 'menu.explore.fromNairobi',
        links: [
          {
            href: '/flights?origin=NBO&destination=MBA&trip=oneway',
            labelKey: 'menu.route.nboMba',
          },
          {
            href: '/flights?origin=NBO&destination=KIS&trip=oneway',
            labelKey: 'menu.route.nboKis',
          },
          {
            href: '/flights?origin=NBO&destination=LHR&trip=oneway',
            labelKey: 'menu.route.nboLhr',
          },
          {
            href: '/flights?origin=NBO&destination=DXB&trip=oneway',
            labelKey: 'menu.route.nboDxb',
          },
          {
            href: '/flights?origin=NBO&destination=DAR&trip=oneway',
            labelKey: 'menu.route.nboDar',
          },
        ],
      },
      {
        titleKey: 'menu.explore.popular',
        links: [
          { href: '/flights?destination=MBA&trip=oneway', labelKey: 'menu.city.mombasa' },
          { href: '/flights?destination=KIS&trip=oneway', labelKey: 'menu.city.kisumu' },
          { href: '/flights?destination=MYD&trip=oneway', labelKey: 'menu.city.malindi' },
          { href: '/flights?destination=LAU&trip=oneway', labelKey: 'menu.city.lamu' },
          { href: '/flights?destination=DAR&trip=oneway', labelKey: 'menu.city.daresalaam' },
        ],
      },
      {
        titleKey: 'menu.explore.longhaul',
        links: [
          { href: '/flights?destination=LHR&trip=oneway', labelKey: 'menu.city.london' },
          { href: '/flights?destination=DXB&trip=oneway', labelKey: 'menu.city.dubai' },
          { href: '/flights?destination=CPT&trip=oneway', labelKey: 'menu.city.capetown' },
          { href: '/flights?destination=JNB&trip=oneway', labelKey: 'menu.city.joburg' },
          { href: '/flights?destination=EBB&trip=oneway', labelKey: 'menu.city.entebbe' },
        ],
      },
    ],
    promo: {
      href: '/plan?tab=holidays',
      labelKey: 'menu.explore.promoCta',
      titleKey: 'menu.explore.promoTitle',
      image: 'holidays',
    },
    actions: [
      { href: '/plan?tab=holidays', labelKey: 'menu.explore.action1', icon: 'beach' },
      { href: '/explore?tab=destinations', labelKey: 'menu.explore.action2', icon: 'globe' },
    ],
  },
  {
    id: 'plan',
    root: '/plan',
    triggerKey: 'nav.plan',
    columns: [
      {
        titleKey: 'menu.plan.documents',
        links: [
          { href: '/plan?tab=checklist', labelKey: 'menu.plan.requirements' },
          { href: '/plan?tab=checklist#eta', labelKey: 'menu.plan.eta' },
          { href: '/plan?tab=checklist#documents', labelKey: 'menu.plan.passports' },
          { href: '/plan?tab=checklist#health', labelKey: 'menu.plan.health' },
          { href: '/plan?tab=checklist#money', labelKey: 'menu.plan.money' },
        ],
      },
      {
        titleKey: 'menu.plan.baggage',
        links: [
          { href: '/plan?tab=checklist#baggage', labelKey: 'menu.plan.allowance' },
          { href: '/plan?tab=checklist#baggage', labelKey: 'menu.plan.handBaggage' },
          { href: '/plan?tab=checklist#pets', labelKey: 'menu.plan.pets' },
          { href: '/plan?tab=checklist#restricted', labelKey: 'menu.plan.restricted' },
          { href: '/manage?tab=support', labelKey: 'menu.plan.lostBaggage' },
        ],
      },
      {
        titleKey: 'menu.plan.services',
        links: [
          { href: '/plan?tab=groups', labelKey: 'menu.plan.groups' },
          { href: '/plan?tab=groups', labelKey: 'menu.plan.corporate' },
          { href: '/rewards?tab=earn', labelKey: 'menu.plan.students' },
          { href: '/manage?tab=support', labelKey: 'menu.plan.charters' },
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.meetGreet' },
        ],
      },
      {
        titleKey: 'menu.plan.specialCare',
        links: [
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.unaccompanied' },
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.infants' },
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.expectant' },
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.mobility' },
          { href: '/manage?tab=support#specials', labelKey: 'menu.plan.specialMeals' },
        ],
      },
    ],
    promo: {
      href: '/alerts',
      labelKey: 'menu.plan.promoCta',
      titleKey: 'menu.plan.promoTitle',
      image: 'plan',
    },
    actions: [
      { href: '/plan?tab=checklist', labelKey: 'menu.plan.action1', icon: 'passport' },
      { href: '/manage?tab=support#specials', labelKey: 'menu.plan.action2', icon: 'cross' },
    ],
  },
  {
    id: 'bookmanage',
    root: '/manage',
    triggerKey: 'nav.bookmanage',
    columns: [
      {
        titleKey: 'menu.book.search',
        links: [
          { href: '/flights', labelKey: 'menu.book.flight' },
          { href: '/flights?trip=oneway&origin=NBO', labelKey: 'menu.book.schedule' },
          { href: '/explore?tab=destinations', labelKey: 'menu.book.where' },
          { href: '/#deals', labelKey: 'menu.book.deals' },
        ],
      },
      {
        titleKey: 'menu.book.online',
        links: [
          { href: '/plan?tab=flights#hold', labelKey: 'menu.book.hold' },
          { href: '/manage?tab=support#payment', labelKey: 'menu.book.payment' },
          { href: '/plan?tab=holidays', labelKey: 'menu.book.holidays' },
          { href: '/flights?trip=multicity', labelKey: 'menu.book.multicity' },
        ],
      },
      {
        titleKey: 'menu.book.manage',
        links: [
          { href: '/manage?tab=changes', labelKey: 'menu.book.change' },
          { href: '/manage?tab=changes#refunds', labelKey: 'menu.book.refunds' },
          { href: '/manage?tab=changes#delays', labelKey: 'menu.book.delays' },
          { href: '/pnr', labelKey: 'menu.book.find' },
        ],
      },
      {
        titleKey: 'menu.book.post',
        links: [
          { href: '/manage?tab=checkin', labelKey: 'menu.book.checkin' },
          { href: '/status', labelKey: 'menu.book.status' },
          { href: '/pnr', labelKey: 'menu.book.passes' },
          { href: '/alerts', labelKey: 'menu.book.alerts' },
        ],
      },
    ],
    promo: {
      href: '/plan?tab=flights#hold',
      labelKey: 'menu.book.promoCta',
      titleKey: 'menu.book.promoTitle',
      image: 'auth',
    },
    actions: [
      { href: '/manage?tab=checkin', labelKey: 'menu.book.action1', icon: 'door' },
      { href: '/pnr', labelKey: 'menu.book.action2', icon: 'search' },
    ],
  },
  {
    id: 'experience',
    root: '/experience',
    triggerKey: 'nav.experience',
    columns: [
      {
        titleKey: 'menu.exp.onboard',
        links: [
          { href: '/experience?tab=service', labelKey: 'menu.exp.service' },
          { href: '/experience?tab=service#meals', labelKey: 'menu.exp.meals' },
          { href: '/experience?tab=service#bags', labelKey: 'menu.exp.cabinBags' },
          { href: '/experience?tab=service#seats', labelKey: 'menu.exp.seats' },
          { href: '/experience?tab=service#planet', labelKey: 'menu.exp.planet' },
        ],
      },
      {
        titleKey: 'menu.exp.fares',
        links: [
          { href: '/experience?tab=cabins#saver', labelKey: 'menu.exp.saver' },
          { href: '/experience?tab=cabins#classic', labelKey: 'menu.exp.classic' },
          { href: '/experience?tab=cabins#flex', labelKey: 'menu.exp.flex' },
          { href: '/experience?tab=cabins#business', labelKey: 'menu.exp.business' },
        ],
      },
      {
        titleKey: 'menu.exp.airport',
        links: [
          { href: '/experience?tab=service#lounge', labelKey: 'menu.exp.lounges' },
          { href: '/experience?tab=service#priority', labelKey: 'menu.exp.priority' },
          { href: '/manage?tab=checkin', labelKey: 'menu.exp.kiosk' },
          { href: '/manage?tab=checkin', labelKey: 'menu.exp.drop' },
        ],
      },
      {
        titleKey: 'menu.exp.aircraft',
        links: [
          { href: '/experience?tab=fleet#E190', labelKey: 'menu.exp.e190' },
          { href: '/experience?tab=fleet#B738', labelKey: 'menu.exp.b738' },
          { href: '/experience?tab=fleet#B789', labelKey: 'menu.exp.b789' },
        ],
      },
    ],
    promo: {
      href: '/experience?tab=fleet',
      labelKey: 'menu.exp.promoCta',
      titleKey: 'menu.exp.promoTitle',
      image: 'experience',
    },
    actions: [
      { href: '/experience?tab=fleet', labelKey: 'menu.exp.action1', icon: 'plane' },
      { href: '/experience?tab=cabins', labelKey: 'menu.exp.action2', icon: 'star' },
    ],
  },
  {
    id: 'rewards',
    root: '/rewards',
    triggerKey: 'nav.rewards',
    columns: [
      {
        titleKey: 'menu.rew.program',
        links: [
          { href: '/rewards', labelKey: 'menu.rew.overview' },
          { href: '/register', labelKey: 'menu.rew.join' },
          { href: '/rewards?tab=earn', labelKey: 'menu.rew.earning' },
          { href: '/rewards?tab=redeem', labelKey: 'menu.rew.redeem' },
        ],
      },
      {
        titleKey: 'menu.rew.tiers',
        links: [
          { href: '/rewards?tab=tiers#blue', labelKey: 'menu.rew.blue' },
          { href: '/rewards?tab=tiers#silver', labelKey: 'menu.rew.silver' },
          { href: '/rewards?tab=tiers#gold', labelKey: 'menu.rew.gold' },
          { href: '/rewards?tab=tiers#platinum', labelKey: 'menu.rew.platinum' },
        ],
      },
      {
        titleKey: 'menu.rew.use',
        links: [
          { href: '/rewards?tab=earn', labelKey: 'menu.rew.flights' },
          { href: '/rewards?tab=earn#partners', labelKey: 'menu.rew.partners' },
          { href: '/rewards?tab=redeem', labelKey: 'menu.rew.upgrades' },
          { href: '/rewards?tab=redeem#awards', labelKey: 'menu.rew.awards' },
        ],
      },
      {
        titleKey: 'menu.rew.help',
        links: [
          { href: '/manage?tab=support', labelKey: 'menu.rew.faqs' },
          { href: '/manage?tab=support', labelKey: 'menu.rew.contact' },
          { href: '/legal#rewards', labelKey: 'menu.rew.terms' },
        ],
      },
    ],
    promo: {
      href: '/register',
      labelKey: 'menu.rew.promoCta',
      titleKey: 'menu.rew.promoTitle',
      image: 'rewards',
    },
    actions: [
      { href: '/rewards?tab=tiers', labelKey: 'menu.rew.action1', icon: 'star' },
      { href: '/register', labelKey: 'menu.rew.action2', icon: 'mega' },
    ],
  },
];

/** Promo-card photo per menu, resolved server-side by the header. */
export type PromoImageKey = 'holidays' | 'plan' | 'auth' | 'experience' | 'rewards';

type IconName =
  'beach' | 'globe' | 'passport' | 'cross' | 'door' | 'search' | 'plane' | 'star' | 'mega';

const ICONS: Record<IconName, ReactNode> = {
  beach: (
    <>
      <path d="M12 21V11" />
      <path d="M12 11c-3-1-6-3-6-6 3 0 5 1 6 3 1-2 3-3 6-3 0 3-3 5-6 6z" />
      <path d="M8 21h8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  passport: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M9 16h6M10 19h4" />
    </>
  ),
  cross: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  door: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20V6l7-2v16" />
      <path d="M17 9l3 2-3 2" />
      <circle cx="11" cy="12" r="0.6" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  plane: (
    <>
      <path d="M4 14l16-6-4 10-4-3-3 3z" />
      <path d="M9 15l3-3" />
    </>
  ),
  star: <path d="M12 4l2.3 4.9 5.2.7-3.8 3.7.9 5.2L12 16l-4.6 2.5.9-5.2L4.5 9.6l5.2-.7z" />,
  mega: (
    <>
      <path d="M4 10v4l10 4V6z" />
      <path d="M14 8c3 1 3 7 0 8" />
      <path d="M7 14v4" />
    </>
  ),
};

function MenuIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6 shrink-0 text-primary"
    >
      {ICONS[name]}
    </svg>
  );
}

export function MegaNav({ promoImages }: { promoImages: Record<PromoImageKey, string> }) {
  const { t } = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState<MenuId | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Outside click and Escape close the open panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = MENUS.find((m) => pathname.startsWith(m.root))?.id ?? null;

  return (
    <nav
      ref={navRef}
      aria-label={t('nav.primary')}
      className="flex items-center gap-1"
      onMouseLeave={() => setOpen(null)}
    >
      {MENUS.map((menu) => {
        const isActive = active === menu.id;
        const isOpen = open === menu.id;
        return (
          <button
            key={menu.id}
            type="button"
            aria-expanded={isOpen}
            aria-controls={`mega-${menu.id}`}
            onMouseEnter={() => setOpen(menu.id)}
            onClick={() => setOpen(isOpen ? null : menu.id)}
            className={`whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium transition-colors ${
              isActive || isOpen
                ? 'border-primary text-primary'
                : 'border-transparent text-foreground hover:text-primary'
            }`}
          >
            {t(menu.triggerKey)}
          </button>
        );
      })}
      <Link
        href="/manage?tab=support"
        className="whitespace-nowrap border-b-2 border-transparent px-2 py-2 text-sm font-medium transition-colors hover:text-primary"
      >
        {t('nav.help')}
      </Link>
      <Link
        href="/flights"
        aria-label={t('nav.searchFlights')}
        title={t('nav.searchFlights')}
        className="ml-1 rounded p-2 text-muted-foreground transition-colors hover:text-primary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
      </Link>

      {MENUS.map((menu) => {
        if (open !== menu.id) return null;
        return (
          <div
            key={menu.id}
            id={`mega-${menu.id}`}
            className="absolute inset-x-0 top-full z-50 border-t-2 border-primary bg-background shadow-2xl"
          >
            <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[repeat(4,minmax(0,1fr))_19rem] lg:gap-8 lg:py-8">
              {menu.columns.map((col) => (
                <div key={col.titleKey}>
                  <h3 className="mb-3 font-display text-base font-semibold not-italic text-foreground">
                    {t(col.titleKey)}
                  </h3>
                  <ul className="space-y-2">
                    {col.links.map((link, index) => (
                      <li key={`${link.href}-${index}`}>
                        <Link
                          href={link.href}
                          onClick={() => setOpen(null)}
                          className="text-sm text-muted-foreground transition-colors hover:text-primary"
                        >
                          {t(link.labelKey)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Promo card — same slot as the airline-site pattern, our copy. */}
              <Link
                href={menu.promo.href}
                onClick={() => setOpen(null)}
                className="group relative hidden h-44 overflow-hidden rounded-xl lg:block"
              >
                {/* Plain img: admin-set photo URLs, low-bandwidth design. */}
                <img
                  src={promoImages[menu.promo.image as PromoImageKey]}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <span className="absolute inset-x-4 bottom-4">
                  <span className="mb-2 block h-1 w-7 rounded-full bg-primary" />
                  <span className="block font-display text-lg italic leading-snug text-white">
                    {t(menu.promo.titleKey)}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-white">
                    {t(menu.promo.labelKey)}
                    <span aria-hidden="true">→</span>
                  </span>
                </span>
              </Link>
            </div>

            {/* Two wide action buttons, red line icons + chevrons. */}
            <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-6 sm:grid-cols-2">
              {menu.actions.map((action) => (
                <Link
                  key={action.href + action.labelKey}
                  href={action.href}
                  onClick={() => setOpen(null)}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-4 transition-colors hover:border-primary/60 hover:bg-accent/40"
                >
                  <MenuIcon name={action.icon} />
                  <span className="flex-1 text-sm font-semibold text-foreground">
                    {t(action.labelKey)}
                  </span>
                  <span aria-hidden="true" className="text-primary">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
