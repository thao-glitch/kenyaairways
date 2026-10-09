/**
 * Check-in window maths (M7).
 *
 * The window is expressed in instants — scheduled departure (UTC) minus an
 * opening lead and a closing cutoff — so no airport-local conversion is
 * involved: every station closes relative to the same physical departure.
 *
 *   too early ──► [ open ] ──► too late
 *               dep-openHours      dep-closeMinutes
 */

export interface CheckInWindowConfig {
  /** How long before departure check-in opens (hours). */
  openHours: number;
  /** How long before departure the gate cutoff ends check-in (minutes). */
  closeMinutes: number;
}

export type CheckInWindowResult =
  { open: true } | { open: false; reason: 'TOO_EARLY' | 'TOO_LATE' };

export function checkInWindow(
  depUtc: Date | string,
  now: Date,
  cfg: CheckInWindowConfig,
): CheckInWindowResult {
  const dep = depUtc instanceof Date ? depUtc.getTime() : Date.parse(depUtc);
  if (!Number.isFinite(dep)) throw new TypeError('checkInWindow: invalid departure time');
  const openAt = dep - cfg.openHours * 3_600_000;
  const closeAt = dep - cfg.closeMinutes * 60_000;
  if (now.getTime() < openAt) return { open: false, reason: 'TOO_EARLY' };
  if (now.getTime() > closeAt) return { open: false, reason: 'TOO_LATE' };
  return { open: true };
}
