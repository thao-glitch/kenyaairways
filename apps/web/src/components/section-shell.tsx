import Link from 'next/link';
import type { ReactNode } from 'react';

export type SectionTab = { href: string; label: string; active?: boolean };

/**
 * Section-page chrome in the airline-editorial style: photographic band with
 * a serif-italic headline + red dash, then a scrollable tab row (plain links —
 * the server owns state) and the tab's content. Shared by the five main
 * section pages and /legal. Tabs arrive pre-translated with their active flag
 * set by the page that owns the state.
 */
export function SectionShell({
  title,
  intro,
  image,
  tabs = [],
  children,
}: {
  title: string;
  intro: string;
  image: string;
  tabs?: SectionTab[];
  children: ReactNode;
}) {
  return (
    <div>
      <div className="relative h-52 w-full overflow-hidden sm:h-60 lg:h-72">
        {/* Plain img: admin-set photo URLs, low-bandwidth design. */}
        <img src={image} alt="" className="h-full w-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/20" />
        <div className="absolute inset-0 mx-auto flex w-full max-w-6xl flex-col justify-end px-4 pb-6">
          <span className="mb-3 h-1 w-10 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="font-display text-3xl italic leading-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/85 sm:text-base">{intro}</p>
        </div>
      </div>

      {tabs.length > 0 && (
        <nav
          aria-label={title}
          className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={tab.active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  tab.active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </nav>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}
