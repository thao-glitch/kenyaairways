type Archetype = 'plains' | 'coast' | 'hills' | 'city';

/** Which illustrated world each airport belongs to (by the city it serves). */
const ARCHETYPE_BY_CODE: Record<string, Archetype> = {
  MYD: 'coast', // Malindi
  LAU: 'coast', // Lamu
  DAR: 'coast', // Dar es Salaam
  KIS: 'hills', // Kisumu
  EDL: 'hills', // Eldoret
  EBB: 'city', // Entebbe
  JNB: 'city', // Johannesburg
  DXB: 'city', // Dubai
  LHR: 'city', // London
  // NBO / WIL / MBA / and anything else default to savannah plains
};

/**
 * Mini destination posters — original hand-drawn SVG scenes (plains, coast,
 * highlands, skyline), one archetype per airport. Decorative: the airport
 * code/city text lives in the card itself, so the art is aria-hidden.
 * Gradient IDs are suffixed with the airport code, making every instance
 * safe to render side by side.
 */
export function DestinationArt({ code, className = '' }: { code: string; className?: string }) {
  const kind = ARCHETYPE_BY_CODE[code] ?? 'plains';
  const id = `dest-${code.toLowerCase()}`;
  return (
    <svg
      viewBox="0 0 320 120"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          {kind === 'plains' && (
            <>
              <stop offset="0" stopColor="#FFE3A3" />
              <stop offset="1" stopColor="#FBC46A" />
            </>
          )}
          {kind === 'coast' && (
            <>
              <stop offset="0" stopColor="#BDEDF6" />
              <stop offset="1" stopColor="#7FD8E8" />
            </>
          )}
          {kind === 'hills' && (
            <>
              <stop offset="0" stopColor="#D8F0C2" />
              <stop offset="1" stopColor="#A8D97E" />
            </>
          )}
          {kind === 'city' && (
            <>
              <stop offset="0" stopColor="#C7C4EE" />
              <stop offset="1" stopColor="#F3C6B8" />
            </>
          )}
        </linearGradient>
      </defs>

      <rect width="320" height="120" fill={`url(#${id}-sky)`} />

      {kind === 'plains' && <Plains />}
      {kind === 'coast' && <Coast />}
      {kind === 'hills' && <Highlands />}
      {kind === 'city' && <Skyline />}
    </svg>
  );
}

function Plains() {
  return (
    <>
      <circle cx="238" cy="44" r="22" fill="#F7C948" />
      <path d="M0 84 Q 80 70 160 82 Q 240 94 320 80 L320 120 L0 120 Z" fill="#D9A441" />
      <path d="M0 96 Q 100 88 200 97 Q 270 103 320 96 L320 120 L0 120 Z" fill="#B57B2C" />
      {/* acacia */}
      <g fill="#5C3A18">
        <path d="M84 98 L84 70" stroke="#5C3A18" strokeWidth="4" />
        <path d="M56 72 Q 72 56 84 56 Q 98 56 114 72 Q 84 78 56 72 Z" />
        <path d="M66 66 Q 84 54 102 66 Q 84 71 66 66 Z" opacity="0.85" />
      </g>
      {/* giraffe-ish neck silhouette for flavour */}
      <path
        d="M268 98 L268 74 q 0 -8 7 -10 l 10 -3 q 5 -1 5 -6 l 0 -5 -7 2 q -6 1 -9 6 l -6 10 q -4 6 -4 14 Z"
        fill="#7A4E1E"
        opacity="0.85"
      />
    </>
  );
}

function Coast() {
  return (
    <>
      <circle cx="76" cy="40" r="20" fill="#FFE9A8" />
      <rect y="72" width="320" height="48" fill="#2FA8C7" />
      <path d="M0 72 Q 80 66 160 72 Q 240 78 320 72 L320 72 L0 72 Z" fill="#54C3DA" />
      {/* dhow */}
      <g fill="#4A3115">
        <path d="M188 70 L188 34 L228 66 Z" fill="#FFFFFF" />
        <path d="M188 70 L188 38 L166 66 Z" fill="#F4E9D0" />
        <path d="M158 74 q 30 12 76 0 l -8 -6 q -30 6 -60 0 Z" />
      </g>
      {/* waves */}
      <g stroke="#BFEFF7" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9">
        <path d="M24 92 q 10 -6 20 0 q 10 6 20 0" />
        <path d="M232 102 q 10 -6 20 0 q 10 6 20 0" />
        <path d="M120 108 q 10 -6 20 0 q 10 6 20 0" />
      </g>
      {/* sand strip */}
      <path d="M0 112 Q 160 104 320 112 L320 120 L0 120 Z" fill="#F2DEB3" />
    </>
  );
}

function Highlands() {
  return (
    <>
      <circle cx="252" cy="36" r="18" fill="#FFF3C2" />
      <path d="M0 70 Q 70 40 150 66 Q 230 92 320 62 L320 120 L0 120 Z" fill="#6FA85B" />
      <path d="M0 88 Q 90 64 180 86 Q 250 102 320 84 L320 120 L0 120 Z" fill="#4F8B47" />
      <path d="M0 104 Q 110 88 220 104 Q 280 112 320 104 L320 120 L0 120 Z" fill="#3B6E38" />
      {/* tea rows */}
      <g stroke="#2F5C2E" strokeWidth="2.5" fill="none" opacity="0.7">
        <path d="M30 108 q 30 -6 60 0" />
        <path d="M140 112 q 30 -6 60 0" />
        <path d="M240 110 q 30 -6 60 0" />
      </g>
      {/* mist band */}
      <rect y="66" width="320" height="8" fill="#FFFFFF" opacity="0.45" />
      <rect y="86" width="320" height="6" fill="#FFFFFF" opacity="0.3" />
    </>
  );
}

function Skyline() {
  return (
    <>
      <circle cx="112" cy="38" r="18" fill="#FFD9A0" />
      {/* buildings */}
      <g fill="#3B3F63">
        <rect x="36" y="58" width="26" height="62" />
        <rect x="70" y="42" width="30" height="78" />
        <rect x="108" y="66" width="22" height="54" />
        <rect x="148" y="34" width="34" height="86" />
        <rect x="190" y="60" width="24" height="60" />
        <rect x="222" y="48" width="28" height="72" />
        <rect x="258" y="70" width="24" height="50" />
      </g>
      {/* tower with spire */}
      <g fill="#2A2D4A">
        <rect x="160" y="12" width="4" height="26" />
        <rect x="157" y="8" width="10" height="8" rx="2" />
      </g>
      {/* window dots */}
      <g fill="#FFE9A8" opacity="0.9">
        <rect x="78" y="52" width="5" height="5" />
        <rect x="88" y="52" width="5" height="5" />
        <rect x="78" y="64" width="5" height="5" />
        <rect x="156" y="46" width="5" height="5" />
        <rect x="166" y="46" width="5" height="5" />
        <rect x="156" y="58" width="5" height="5" />
        <rect x="230" y="60" width="5" height="5" />
        <rect x="240" y="60" width="5" height="5" />
      </g>
      {/* departing dart */}
      <g transform="translate(272 26) rotate(-16)">
        <path d="M16 0 L-6 12 L0 8 Z" fill="#FFFFFF" />
        <path d="M16 0 L2 18 L0 8 Z" fill="#E8EEF7" />
      </g>
      <path
        d="M216 44 Q 244 32 264 28"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeDasharray="1 8"
        strokeLinecap="round"
        fill="none"
      />
    </>
  );
}
