'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A real photograph (destination, hero, banner). Loads lazily below the
 * fold, keeps its box with a muted placeholder while loading, and quietly
 * degrades to the placeholder if the URL ever dies — an admin typo must
 * never break a page. A plain <img> (not next/image) on purpose: admin-set
 * URLs point at arbitrary https origins, and the low-bandwidth design
 * skips the optimizer.
 */
export function SitePhoto({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Hero/banner images above the fold pass eager to skip lazy-load. */
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={cn('relative block overflow-hidden bg-muted', className)}>
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
      {failed && <span aria-hidden="true" className="block h-full w-full bg-muted" />}
    </span>
  );
}
