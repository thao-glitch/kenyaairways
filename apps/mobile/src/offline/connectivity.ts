/**
 * Backend reachability: decides whether requests go to the PC backend or the
 * on-device engine.
 *
 * - `mode` starts as 'remote' (optimistic) and flips to 'local' the moment a
 *   probe fails OR a fetch throws a network error (`markOffline`), so the app
 *   keeps working the second the PC goes away.
 * - While local, the monitor re-probes every 30 s and on every AppState
 *   'active' — when the PC comes back the mode returns to 'remote' and
 *   listeners invalidate their queries.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { getApiBase, probeApi } from '@/lib/server';

export type BackendMode = 'remote' | 'local';

let mode: BackendMode = 'remote';
const listeners = new Set<(mode: BackendMode) => void>();
let monitorStarted = false;
let probing = false;

export function getBackendMode(): BackendMode {
  return mode;
}

export function isLocal(): boolean {
  return mode === 'local';
}

export function subscribeBackendMode(fn: (mode: BackendMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setMode(next: BackendMode): void {
  if (mode === next) return;
  mode = next;
  for (const fn of [...listeners]) {
    try {
      fn(next);
    } catch {
      /* listener errors never break connectivity */
    }
  }
}

/** A fetch just failed with a network error — fail over immediately. */
export function markOffline(): void {
  setMode('local');
}

/** One probe against the configured backend; updates the mode. */
export async function probeBackend(timeoutMs = 2500): Promise<boolean> {
  if (probing) return mode === 'remote';
  probing = true;
  try {
    const up = await probeApi(getApiBase(), timeoutMs);
    setMode(up ? 'remote' : 'local');
    return up;
  } catch {
    setMode('local');
    return false;
  } finally {
    probing = false;
  }
}

async function onAppStateActive(): Promise<void> {
  if (mode === 'local') await probeBackend();
}

/**
 * Start re-probing while offline (AppState + interval). Safe to call multiple
 * times — only the first call registers monitors. Call from App.tsx.
 */
export function startConnectivityMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;

  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void onAppStateActive();
  });
  // Keep the subscription alive for the app's lifetime.
  void subscription;

  setInterval(() => {
    if (mode === 'local') void probeBackend();
  }, 30_000);

  // First look: if the configured backend is already down, go local at once.
  void probeBackend();
}
