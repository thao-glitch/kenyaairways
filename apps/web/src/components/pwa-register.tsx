'use client';

import { useEffect } from 'react';

/**
 * Registers the offline/installability service worker in production only —
 * dev keeps the uncached HMR experience. Failures are silent (e.g. the
 * browser blocks SW on plain-HTTP non-localhost origins).
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker?.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
