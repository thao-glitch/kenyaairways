/**
 * Kenya Airways brand mark — an original hand-drawn SVG: a folded paper dart
 * climbing out of a dawn sun, inside a rounded sky tile. Used in the header,
 * footer and boarding pass; the same geometry ships as `app/icon.svg`.
 * Purely presentational (no hooks) so server and client components can
 * both render it.
 */
export function BrandMark({
  className = 'h-8 w-8',
  decorative = true,
  title,
}: {
  className?: string;
  /** When true the mark is hidden from assistive tech (logo-in-a-link case). */
  decorative?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : (title ?? 'Kenya Airways')}
      focusable="false"
    >
      <defs>
        <linearGradient id="f13-mark-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1499D6" />
          <stop offset="1" stopColor="#0A4E7A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#f13-mark-sky)" />
      {/* dawn sun */}
      <circle cx="10.5" cy="11" r="5" fill="#F7C948" opacity="0.92" />
      {/* horizon haze */}
      <path d="M0 24 Q 16 19 32 24 L32 24 L32 32 Q16 28 0 32 Z" fill="#0A4E7A" opacity="0.35" />
      {/* folded paper dart, nose to the upper right */}
      <path d="M28 5 L10.5 21.5 L18.5 18.5 Z" fill="#FFFFFF" />
      <path d="M28 5 L21.5 28 L18.5 18.5 Z" fill="#DFF3FC" />
      {/* fold line */}
      <path d="M28 5 L18.5 18.5" stroke="#0A4E7A" strokeOpacity="0.25" strokeWidth="0.75" />
    </svg>
  );
}
