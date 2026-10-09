/** Remaining milliseconds → `14m 05s`, `2h 14m`, `1d 3h 05m`. */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m 00s';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}h ${mm}m`;
  if (hours > 0) return `${hours}h ${mm}m`;
  return `${minutes}m ${ss}s`;
}

/** Flight duration in minutes → `55m`, `1h 05m`. */
export function formatDurationShort(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}
