'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/i18n-provider';

/**
 * Fixed edge furniture from the reference design: a red vertical Feedback tab
 * (routes to support — a real destination) and a red back-to-top square that
 * fades in after the fold.
 */
export function EdgeWidgets() {
  const { t } = useT();
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setShowTop(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <a
        href="/manage?tab=support"
        className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-l-md bg-primary px-2 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground shadow-md transition-colors hover:bg-primary/90 lg:block"
        style={{ writingMode: 'vertical-rl' }}
      >
        {t('edge.feedback')}
      </a>

      <button
        type="button"
        aria-label={t('edge.backToTop')}
        title={t('edge.backToTop')}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-lg transition-opacity duration-300 hover:bg-primary/90 ${
          showTop ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </>
  );
}
