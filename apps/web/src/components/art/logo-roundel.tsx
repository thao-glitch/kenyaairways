/**
 * Header/footer roundel — the house mark: a warm porcelain disc framed by a
 * double gold rim, carrying a solid crimson wing with a swallow-tail split
 * at its tip and a hairline feather slit through the body. The light disc
 * reads on any backdrop (crimson header block, black footer, white admin
 * shell); geometry is original. Purely presentational so server and client
 * components can both render it.
 */
export function LogoRoundel({
  className = 'h-9 w-9',
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id="f13-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f7e3a1" />
          <stop offset="45%" stopColor="#d8a62a" />
          <stop offset="100%" stopColor="#a87a16" />
        </linearGradient>
        <radialGradient id="f13-ivory" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#fdf8ee" />
          <stop offset="100%" stopColor="#f0e4cc" />
        </radialGradient>
        <linearGradient
          id="f13-wing"
          gradientUnits="userSpaceOnUse"
          x1="11"
          y1="34"
          x2="39"
          y2="13"
        >
          <stop offset="0%" stopColor="#8f0a1f" />
          <stop offset="55%" stopColor="#c8102e" />
          <stop offset="100%" stopColor="#e8354c" />
        </linearGradient>
      </defs>
      {/* porcelain disc, gold rim + inner hairline */}
      <circle
        cx="24"
        cy="24"
        r="23.1"
        fill="url(#f13-ivory)"
        stroke="url(#f13-gold)"
        strokeWidth="1.7"
      />
      <circle
        cx="24"
        cy="24"
        r="20.3"
        fill="none"
        stroke="url(#f13-gold)"
        strokeWidth="0.6"
        opacity="0.75"
      />
      {/* the wing: solid sweep with a swallow-tail tip */}
      <path
        d="M10.9 32.9
           C16.0 23.3, 26.4 15.9, 38.9 13.6
           C33.9 17.9, 31.3 20.6, 29.6 23.4
           C31.8 24.2, 34.6 24.8, 37.5 24.7
           C32.0 28.2, 24.0 30.9, 16.6 33.0
           C14.6 33.5, 12.2 33.5, 10.9 32.9 Z"
        fill="url(#f13-wing)"
      />
      {/* hairline feather slit through the body */}
      <path
        d="M15.4 31.3C19.8 28.3, 24.6 25.9, 28.9 24.2"
        fill="none"
        stroke="#fbf6ea"
        strokeWidth="0.85"
        strokeLinecap="round"
      />
    </svg>
  );
}
