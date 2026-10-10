/**
 * Route arc — a small original SVG: origin/destination nodes joined by a
 * dotted flight path with a dart at the apex, plus a duration bar. Uses
 * currentColor so it adapts to text tokens in light or dark contexts.
 * Decorative (the card already states the airports and duration in text).
 */
export function RouteArc({
  progress = 0.55,
  className = '',
}: {
  /** 0…1 — where along the arc the dart sits (purely visual). */
  progress?: number;
  className?: string;
}) {
  // Quadratic bezier point at parameter t: (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
  const t = Math.min(1, Math.max(0, progress));
  const p0 = { x: 14, y: 34 };
  const p1 = { x: 110, y: 4 };
  const p2 = { x: 206, y: 34 };
  const at = (a: number, b: number, c: number): number =>
    (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  const x = at(p0.x, p1.x, p2.x);
  const y = at(p0.y, p1.y, p2.y);
  // tangent → rotation
  const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <svg viewBox="0 0 220 48" className={className} aria-hidden="true" focusable="false">
      <path
        d={`M${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 9"
      />
      <circle cx={p0.x} cy={p0.y} r="5" fill="currentColor" fillOpacity="0.8" />
      <circle cx={p2.x} cy={p2.y} r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <g transform={`translate(${x} ${y}) rotate(${angle})`}>
        <path d="M9 0 L-3 7 L0 4 Z" fill="currentColor" />
        <path d="M9 0 L1 11 L0 4 Z" fill="currentColor" fillOpacity="0.65" />
      </g>
    </svg>
  );
}
