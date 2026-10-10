/**
 * Empty / error state illustration — an original SVG of a paper dart
 * circling back over a dotted loop (with optional question marks for the
 * 404 variant). Decorative; the message text renders beside/below it.
 */
export function EmptyStateArt({
  variant = 'search',
  className = '',
}: {
  variant?: 'search' | 'notFound';
  className?: string;
}) {
  return (
    <svg viewBox="0 0 240 150" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="empty-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E7F5FD" />
          <stop offset="1" stopColor="#FDF6E6" />
        </linearGradient>
      </defs>
      <rect x="20" y="10" width="200" height="120" rx="16" fill="url(#empty-sky)" />
      {/* soft hill */}
      <path
        d="M20 104 Q 90 88 160 102 Q 200 110 220 104 L220 126 Q 120 134 20 126 Z"
        fill="#EADFC4"
      />
      {/* dotted loop */}
      <path
        d="M70 84 Q 66 50 110 46 Q 158 42 164 72 Q 170 100 132 104 Q 96 108 92 86 Q 88 68 116 66"
        fill="none"
        stroke="#0A4E7A"
        strokeOpacity="0.45"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 11"
      />
      {/* dart at the end of the loop */}
      <g transform="translate(116 66) rotate(38)">
        <path d="M14 0 L-5 10 L0 6 Z" fill="#0A4E7A" />
        <path d="M14 0 L2 16 L0 6 Z" fill="#14688F" />
      </g>
      {/* cloud */}
      <g fill="#FFFFFF" opacity="0.9">
        <ellipse cx="180" cy="40" rx="26" ry="9" />
        <circle cx="170" cy="34" r="10" />
        <circle cx="188" cy="32" r="12" />
      </g>
      {variant === 'notFound' && (
        <g fill="#0A4E7A" fontWeight="700" fontSize="26" fontFamily="inherit">
          <text x="52" y="56" opacity="0.75">
            ?
          </text>
          <text x="196" y="84" opacity="0.55" fontSize="18">
            ?
          </text>
        </g>
      )}
    </svg>
  );
}
