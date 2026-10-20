'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CarouselItem = { href: string; src: string; label: string; sub?: string };

/**
 * Destinations strip in the stopover-carousel slot: scroll-snap track with
 * round red arrows and per-item dots (active dot follows the scroll), so it
 * behaves natively at every breakpoint with one small island.
 */
export function PhotoCarousel({
  items,
  prevLabel,
  nextLabel,
  gotoLabel,
}: {
  items: CarouselItem[];
  prevLabel: string;
  nextLabel: string;
  gotoLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const children = Array.from(track.children) as HTMLElement[];
    const left = track.scrollLeft;
    let best = 0;
    let bestDist = Infinity;
    children.forEach((child, index) => {
      const dist = Math.abs(child.offsetLeft - left);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    setActive(best);
  }, []);

  useEffect(() => {
    syncActive();
  }, [syncActive]);

  const nudge = (dir: 1 | -1): void => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.max(240, track.clientWidth * 0.7), behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={syncActive}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => (
          <Link
            key={`${item.href}-${index}`}
            href={item.href}
            className="group relative h-44 w-[calc(50%-0.5rem)] shrink-0 snap-start overflow-hidden rounded-xl sm:w-[calc(33.333%-0.75rem)] lg:w-[calc(25%-0.75rem)]"
          >
            {/* Plain img: curated photo URLs, low-bandwidth design. */}
            <img
              src={item.src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
            <span className="absolute inset-x-3 bottom-3">
              <span className="block h-0.5 w-6 rounded-full bg-primary" aria-hidden="true" />
              <span className="mt-1.5 block font-display text-lg italic text-white">
                {item.label}
              </span>
              {item.sub && <span className="block text-xs text-white/80">{item.sub}</span>}
            </span>
          </Link>
        ))}
      </div>

      <button
        type="button"
        aria-label={prevLabel}
        title={prevLabel}
        onClick={() => nudge(-1)}
        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-primary shadow-md transition-colors hover:bg-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => nudge(1)}
        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-primary shadow-md transition-colors hover:bg-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label={gotoLabel}>
        {items.map((item, index) => (
          <button
            key={`dot-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={`${gotoLabel} ${index + 1}`}
            onClick={() => {
              const track = trackRef.current;
              const child = track?.children[index] as HTMLElement | undefined;
              if (track && child) track.scrollTo({ left: child.offsetLeft, behavior: 'smooth' });
            }}
            className={`h-2 rounded-full transition-all ${
              index === active ? 'w-5 bg-primary' : 'w-2 bg-border hover:bg-muted-foreground/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
