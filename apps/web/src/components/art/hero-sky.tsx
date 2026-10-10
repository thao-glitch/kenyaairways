/**
 * Hero landscape — an original hand-drawn SVG scene: dawn over the Kenyan
 * plains (twin peak, layered hills, flat-top acacias, a climbing paper dart
 * on a dotted route arc). Decorative only; the hero copy sits above it.
 *
 * The viewBox keeps all key subjects inside x∈[350,850] so narrow mobile
 * viewports (which slice-crop the sides) still frame the sun, peak and plane.
 */
export function HeroSky({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8FD3F4" />
          <stop offset="0.55" stopColor="#CFEDF9" />
          <stop offset="1" stopColor="#FDF3DC" />
        </linearGradient>
        <radialGradient id="hero-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE9A8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFE9A8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C9884A" />
          <stop offset="1" stopColor="#8C5A2B" />
        </linearGradient>
      </defs>

      {/* sky */}
      <rect width="1200" height="420" fill="url(#hero-sky)" />

      {/* sun + glow */}
      <circle cx="740" cy="300" r="120" fill="url(#hero-glow)" />
      <circle cx="740" cy="300" r="40" fill="#F7C948" />

      {/* clouds */}
      <g fill="#FFFFFF" opacity="0.75">
        <ellipse cx="260" cy="86" rx="62" ry="17" />
        <circle cx="234" cy="76" r="18" />
        <circle cx="276" cy="72" r="22" />
      </g>
      <g fill="#FFFFFF" opacity="0.6">
        <ellipse cx="960" cy="130" rx="54" ry="14" />
        <circle cx="940" cy="121" r="15" />
        <circle cx="974" cy="118" r="18" />
      </g>
      <g fill="#FFFFFF" opacity="0.5">
        <ellipse cx="520" cy="60" rx="44" ry="12" />
        <circle cx="504" cy="52" r="13" />
        <circle cx="534" cy="50" r="15" />
      </g>

      {/* climbing dart with dotted route arc */}
      <path
        d="M470 176 Q 600 120 686 110"
        fill="none"
        stroke="#0A4E7A"
        strokeOpacity="0.55"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 12"
      />
      <circle
        cx="470"
        cy="176"
        r="5"
        fill="none"
        stroke="#0A4E7A"
        strokeOpacity="0.6"
        strokeWidth="2.5"
      />
      <g transform="translate(700 104) rotate(-18)">
        <path d="M26 0 L-8 20 L0 12 Z" fill="#0A4E7A" />
        <path d="M26 0 L2 30 L0 12 Z" fill="#14688F" />
      </g>

      {/* far ridge with twin peak */}
      <path
        d="M0 322 L140 268 L230 306 L330 252 L420 300 L520 244 L560 214 L600 246 L700 296 L820 250 L930 300 L1050 256 L1160 298 L1200 280 L1200 420 L0 420 Z"
        fill="#6E93A8"
        opacity="0.55"
      />
      {/* mid hills */}
      <path
        d="M0 344 Q 150 316 300 340 Q 460 366 620 338 Q 790 312 950 342 Q 1080 364 1200 340 L1200 420 L0 420 Z"
        fill="#A67B4F"
        opacity="0.75"
      />
      {/* plains */}
      <path
        d="M0 366 Q 200 350 420 366 Q 660 384 880 364 Q 1040 350 1200 366 L1200 420 L0 420 Z"
        fill="url(#hero-ground)"
      />

      {/* acacia A (inside the mobile crop band) */}
      <g fill="#4A3115">
        <path d="M430 372 L430 330" stroke="#4A3115" strokeWidth="5" />
        <path d="M430 336 L418 326 M430 340 L444 328" stroke="#4A3115" strokeWidth="4" />
        <path d="M392 330 Q 410 310 430 310 Q 452 310 470 330 Q 430 338 392 330 Z" />
        <path d="M404 322 Q 430 306 456 322 Q 430 328 404 322 Z" opacity="0.85" />
      </g>
      {/* acacia B (desktop framing) */}
      <g fill="#4A3115" opacity="0.9">
        <path d="M980 374 L980 340" stroke="#4A3115" strokeWidth="4" />
        <path d="M950 340 Q 966 322 980 322 Q 996 322 1012 340 Q 980 347 950 340 Z" />
      </g>

      {/* grass tufts */}
      <g stroke="#5C3A18" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <path d="M120 392 q 4 -12 8 0 M132 394 q 4 -10 8 0" />
        <path d="M640 398 q 4 -12 8 0 M652 400 q 4 -10 8 0" />
        <path d="M1080 392 q 4 -12 8 0" />
      </g>
    </svg>
  );
}
